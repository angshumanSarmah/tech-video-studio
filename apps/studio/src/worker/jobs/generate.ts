import {
  buildAssetRegistry,
  DEFAULT_REGISTRIES,
  generatorCatalogueBlock,
  withRegistryChecks,
  type Registries,
} from '@explainer-studio/renderer/catalog';
import {
  PROGRESS_DONE_PCT,
  SpecIdSchema,
  validateVideoSpec,
  type BeatScene,
  type GenerateInput,
  type GenerateOutput,
  type GenerateWarning,
  type LlmSettings,
  type MissingPrimitiveRequest,
  type ResearchNotes,
  type SpecError,
  type Stage,
  type VideoSettings,
  type VideoSpec,
} from '@explainer-studio/shared';
import { z } from 'zod';
import { recordMissingAssets, prepareRenderAssets } from '#core/assets/render-assets.ts';
import { loadAssetLibrary } from '#core/assets/library.ts';
import {
  generateInputPath,
  generateOutputPath,
  readDataJson,
  writeDataJson,
} from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import {
  failInterruptedSteps,
  failRunStep,
  finishRunStep,
  setRunStepInput,
  startRunStep,
} from '#core/db/repositories/run-steps.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { NotFoundError } from '#core/errors.ts';
import { latestDirection } from '#core/services/direction.ts';
import { researchOfStep } from '#core/services/research-notes.ts';
import { pinnedSpecVersion, saveSpecVersion } from '#core/services/spec-versions.ts';
import { activeStyleRules } from '#core/services/style-rules.ts';
import { drawBeat, type BeatResult, type BeatStepContext } from '../agents/generator/beat-step.ts';
import { spliceBoards } from '../agents/generator/board.ts';
import { generatorSceneCheck } from '../agents/generator/check.ts';
import {
  beatDependency,
  beatDependents,
  createWarmUp,
  visibleScenes,
} from '../agents/generator/schedule.ts';
import { resolvePromptVariables } from '../agents/prompt-variables.ts';
import type { PromptTemplates } from '../agents/prompts/templates.ts';
import { styleRulesSection } from '../agents/sections.ts';
import {
  blockingIssues,
  formatIssues,
  LlmOutputInvalidError,
  type LlmClient,
} from '../llm/client.ts';
import type { OutputIssue } from '../llm/types.ts';
import { defineJobHandler, type JobContext, type JobHandler } from './handler.ts';

export const GENERATE_JOB_TYPE = 'generate' satisfies Stage;

export interface GenerateJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
  /** App defaults (`settings.video` for the prompt variables) and the model per role. */
  readonly settings: {
    readonly video: VideoSettings;
    readonly llm: Pick<LlmSettings, 'models'>;
  };
}

const PayloadSchema = z.strictObject({
  specVersionId: z.number().int().positive(),
  /** Regenerate this beat only (a gate's request), then what it breaks. */
  beatId: SpecIdSchema.optional(),
  /** The reviewer's note for a regenerated beat. */
  feedback: z.string().trim().min(1).optional(),
});
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

/** Everything a job reads, loaded once. */
interface GenerateJob {
  readonly spec: VideoSpec;
  readonly specVersion: number;
  readonly notes: ResearchNotes;
  readonly registries: Registries;
  readonly input: GenerateInput;
}

/** What the job knows about each beat as it goes. */
interface BeatRecord {
  stepId: number | null;
  outcome: GenerateOutput['beats'][number]['outcome'];
  retried: boolean;
  requests: readonly MissingPrimitiveRequest[];
}

interface Boards {
  readonly scenes: (BeatScene | undefined)[];
  readonly records: Map<number, BeatRecord>;
  /** Beats drawn or reused in this job: the only ones the post-pass may retry. */
  readonly touched: Set<number>;
}

/**
 * The Generator (P1C.7): draws every beat's board of a pinned spec version and saves the spec
 * with its scene layer as the run's next version. Beats of a `continuesPrevious` chain (and a
 * `semantic_zoom` beat after its board) run in order, independent chains in parallel under the
 * LLM client's `llm.maxConcurrent`, after one warm-up call that caches the shared prefix. Each
 * beat attempt is its own `run_steps` row (`beat_id`); one with the same input hash is reused,
 * so a resumed job pays only for what it had not finished. A post-pass runs the checks across
 * boards and retries each offending beat once; what is left goes to gate 3 as warnings in the
 * job's output. With `beatId`, only that beat is drawn again, then the later beats of its chain
 * that no longer pass.
 */
export function generateJobHandler(deps: GenerateJobDeps): JobHandler {
  return defineJobHandler({
    type: GENERATE_JOB_TYPE,
    description: 'Draw each beat’s board (scene JSON) and save the spec with its scene layer.',
    payloadSchema: PayloadSchema,
    run: (ctx) => generate(deps, ctx),
  });
}

async function generate(deps: GenerateJobDeps, ctx: Ctx): Promise<void> {
  const runId = ctx.job.runId;
  if (runId === null) throw new Error('A generate job needs a run.');
  const run = getRun(deps.db, runId);
  if (!run) throw new NotFoundError('run', runId);
  if (failInterruptedSteps(deps.db, runId, GENERATE_JOB_TYPE) > 0) {
    ctx.log('warn', 'An earlier Generator attempt was interrupted; finished beats are reused.');
  }
  const step = startRunStep(deps.db, { runId, stage: GENERATE_JOB_TYPE });
  try {
    const job = prepare(deps, runId, ctx);
    setRunStepInput(
      deps.db,
      step.id,
      writeDataJson(deps.dataDir, generateInputPath(runId, step.id), job.input),
    );
    ctx.progress(5, 'Spec and notes loaded');
    const c = beatContext(deps, ctx, runId, run.settings, job);
    const boards = ctx.payload.beatId
      ? await regenerate(c, job, ctx, ctx.payload.beatId)
      : await drawAll(c, job, ctx);
    const warnings = await postPass(c, job, boards, ctx);
    const output = save(deps, runId, job, boards, warnings, step.id);
    finishRunStep(
      deps.db,
      step.id,
      writeDataJson(deps.dataDir, generateOutputPath(runId, step.id), output),
    );
    ctx.log('info', summarize(output));
    ctx.progress(PROGRESS_DONE_PCT, 'Boards ready');
  } catch (error) {
    failRunStep(deps.db, step.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function prepare(deps: GenerateJobDeps, runId: number, ctx: Ctx): GenerateJob {
  const pinned = pinnedSpecVersion(deps.db, runId, ctx.payload.specVersionId);
  const spec = scriptedSpec(readDataJson(deps.dataDir, pinned.jsonPath), pinned.version);
  if (!spec.timing) ctx.log('warn', 'The spec has no timing yet: word times are estimated.');
  const direction = latestDirection(deps.db, deps.dataDir, runId);
  if (!direction) throw new Error('The run has no finished plan: run the Director first.');
  const researchStepId = direction.input.researchStepId;
  const research = researchOfStep(deps.db, deps.dataDir, researchStepId);
  if (!research) {
    throw new Error(`The plan's research step ${researchStepId} has no finished notes.`);
  }
  return {
    spec,
    specVersion: pinned.version,
    notes: research.notes,
    registries: libraryRegistries(deps, ctx),
    input: {
      specVersionId: pinned.id,
      beatId: ctx.payload.beatId ?? null,
      feedback: ctx.payload.feedback ?? null,
      directStepId: direction.step.id,
      researchStepId,
      model: deps.settings.llm.models.generator,
      styleRules: activeStyleRules(deps.db, 'generator'),
    },
  };
}

/** The spec with its script (validated); the Generator draws for that script. */
function scriptedSpec(raw: unknown, version: number): VideoSpec {
  const result = validateVideoSpec(raw);
  if (!result.ok)
    throw new Error(`Spec v${version} is invalid:\n${formatSpecIssues(result.errors)}`);
  if (!result.spec.script?.length) throw new Error(`Spec v${version} has no script to draw.`);
  return result.spec;
}

/** The registries with the DB's approved assets: the list the prompt shows and checks use. */
function libraryRegistries(deps: GenerateJobDeps, ctx: Ctx): Registries {
  const library = loadAssetLibrary(deps.db, deps.dataDir);
  for (const p of library.problems) {
    ctx.log('warn', `Asset ${p.id} is left out of the Generator's list: ${p.message}`);
  }
  return { ...DEFAULT_REGISTRIES, assets: buildAssetRegistry(library.assets) };
}

function beatContext(
  deps: GenerateJobDeps,
  ctx: Ctx,
  runId: number,
  settings: Parameters<typeof resolvePromptVariables>[0],
  job: GenerateJob,
): BeatStepContext {
  const styleRules = styleRulesSection(job.input.styleRules);
  return {
    db: deps.db,
    dataDir: deps.dataDir,
    llm: deps.llm,
    prompts: deps.prompts,
    variables: resolvePromptVariables(settings, deps.settings.video),
    catalogue: generatorCatalogueBlock(job.registries),
    ...(styleRules ? { styleRules } : {}),
    model: job.input.model,
    runId,
    notes: job.notes,
    registries: job.registries,
    warmUp: createWarmUp(),
    signal: ctx.signal,
    log: ctx.log,
  };
}

function emptyBoards(spec: VideoSpec): Boards {
  return { scenes: spec.story.beats.map(() => undefined), records: new Map(), touched: new Set() };
}

function record(boards: Boards, index: number, result: BeatResult, retried = false): void {
  boards.scenes[index] = result.scene;
  boards.touched.add(index);
  boards.records.set(index, {
    stepId: result.stepId,
    outcome: result.reused ? 'reused' : 'generated',
    retried,
    requests: result.output.missingPrimitiveRequests,
  });
}

/**
 * Every beat: each waits for the beat it depends on; independent chains start together (the
 * client's semaphore and the warm-up decide when they call). A failed beat fails the job once
 * every other beat has settled, so finished beats are saved for the resumed job.
 */
async function drawAll(c: BeatStepContext, job: GenerateJob, ctx: Ctx): Promise<Boards> {
  const { spec } = job;
  const boards = emptyBoards(spec);
  const total = spec.story.beats.length;
  const done: Promise<void>[] = [];
  for (let i = 0; i < total; i += 1) {
    const dependency = beatDependency(spec, i);
    const ready = dependency === undefined ? Promise.resolve() : done[dependency];
    done[i] = (ready ?? Promise.resolve()).then(async () => {
      const result = await drawBeat(c, {
        spec,
        scenes: visibleScenes(spec, i, boards.scenes),
        beatIndex: i,
        reason: 'generate',
      });
      record(boards, i, result);
      const beatId = spec.story.beats[i]?.id ?? String(i);
      const pct = 5 + Math.round((boards.records.size / total) * 75);
      ctx.progress(pct, `Beat ${beatId} ${result.reused ? 'reused' : 'drawn'}`);
    });
  }
  const failure = (await Promise.allSettled(done)).find((r) => r.status === 'rejected');
  if (failure) throw failure.reason;
  return boards;
}

/**
 * One beat again (a gate's request, with its feedback): the rest come from the pinned spec.
 * The later beats of its chain are checked against the new board and drawn again only when
 * they no longer pass.
 */
async function regenerate(
  c: BeatStepContext,
  job: GenerateJob,
  ctx: Ctx,
  beatId: string,
): Promise<Boards> {
  const { spec } = job;
  const index = spec.story.beats.findIndex((b) => b.id === beatId);
  if (index < 0) throw new Error(`Spec v${job.specVersion} has no beat "${beatId}".`);
  const boards = pinnedBoards(job);
  const result = await drawBeat(c, {
    spec,
    scenes: visibleScenes(spec, index, boards.scenes),
    beatIndex: index,
    reason: 'regenerate',
    ...(job.input.feedback ? { feedback: job.input.feedback } : {}),
    salt: `job-${ctx.job.id}`,
  });
  record(boards, index, result);
  ctx.progress(40, `Beat ${beatId} drawn again`);
  for (const j of beatDependents(spec, index)) {
    const issues = blockingIssues(boardCheck(c, job, boards, j, false));
    if (issues.length === 0) continue;
    const later = spec.story.beats[j]?.id ?? String(j);
    ctx.log('info', `Beat ${later} no longer fits beat ${beatId}'s new board (${codes(issues)}).`);
    const redrawn = await drawBeat(c, {
      spec,
      scenes: visibleScenes(spec, j, boards.scenes),
      beatIndex: j,
      reason: 'revalidate',
    });
    record(boards, j, redrawn);
  }
  return boards;
}

/** The pinned spec's boards, every beat `kept`; it must have one per beat. */
function pinnedBoards(job: GenerateJob): Boards {
  const boards = emptyBoards(job.spec);
  const byId = new Map((job.spec.scenes ?? []).map((s) => [s.beatId, s]));
  job.spec.story.beats.forEach((beat, i) => {
    const scene = byId.get(beat.id);
    if (!scene) {
      throw new Error(
        `Spec v${job.specVersion} has no board for beat "${beat.id}": generate the whole video first.`,
      );
    }
    boards.scenes[i] = scene;
    boards.records.set(i, { stepId: null, outcome: 'kept', retried: false, requests: [] });
  });
  return boards;
}

/** A beat's issues with every board in place (`crossBoard`: also the checks across boards). */
function boardCheck(
  c: BeatStepContext,
  job: GenerateJob,
  boards: Boards,
  index: number,
  crossBoard: boolean,
): OutputIssue[] {
  const scene = boards.scenes[index];
  if (!scene) return [];
  const scenes = crossBoard ? boards.scenes : visibleScenes(job.spec, index, boards.scenes);
  return generatorSceneCheck(
    {
      spec: job.spec,
      scenes,
      beatIndex: index,
      notes: job.notes,
      registries: c.registries,
      crossBoard,
    },
    scene,
  );
}

/**
 * With every board in place: each beat drawn in this job that now fails a check (across boards,
 * or one that needed the next board, such as a draw cut short) gets one retry with its issues as
 * feedback, in beat order. A retry that still fails keeps the earlier board. Returns every
 * issue left on every board, for gate 3.
 */
async function postPass(
  c: BeatStepContext,
  job: GenerateJob,
  boards: Boards,
  ctx: Ctx,
): Promise<GenerateWarning[]> {
  const before = allIssues(c, job, boards);
  let retried = false;
  for (const index of [...boards.touched].sort((a, b) => a - b)) {
    const issues = blockingIssues(before.get(index) ?? []);
    if (issues.length === 0) continue;
    const beatId = job.spec.story.beats[index]?.id ?? String(index);
    ctx.log('warn', `Beat ${beatId} fails across boards (${codes(issues)}): one retry.`);
    retried = true;
    try {
      const result = await drawBeat(c, {
        spec: job.spec,
        scenes: visibleScenes(job.spec, index, boards.scenes),
        checkScenes: boards.scenes,
        beatIndex: index,
        reason: 'retry',
        feedback: formatIssues(issues),
        crossBoard: true,
      });
      record(boards, index, result, true);
    } catch (error) {
      if (!(error instanceof LlmOutputInvalidError)) throw error;
      ctx.log('warn', `Beat ${beatId}: the retry still failed; its board goes to the gate as is.`);
    }
  }
  ctx.progress(90, 'Checked across boards');
  const after = retried ? allIssues(c, job, boards) : before;
  return [...after].flatMap(([index, issues]) =>
    issues.map((issue) => warningOf(job.spec.story.beats[index]?.id ?? String(index), issue)),
  );
}

function allIssues(c: BeatStepContext, job: GenerateJob, boards: Boards) {
  return new Map(job.spec.story.beats.map((_, i) => [i, boardCheck(c, job, boards, i, true)]));
}

function warningOf(beatId: string, issue: OutputIssue): GenerateWarning {
  return {
    beatId,
    path: issue.path,
    code: issue.code ?? null,
    message: issue.message,
    soft: issue.soft ?? false,
  };
}

const codes = (issues: readonly OutputIssue[]) =>
  [...new Set(issues.map((i) => i.code ?? 'issue'))].join(', ');

/** Saves the spec with its boards, records missing assets and sums this job's calls. */
function save(
  deps: GenerateJobDeps,
  runId: number,
  job: GenerateJob,
  boards: Boards,
  warnings: GenerateWarning[],
  jobStepId: number,
): GenerateOutput {
  const spec = assembledSpec(job, boards);
  const saved = saveSpecVersion(deps.db, deps.dataDir, {
    runId,
    spec,
    createdBy: 'agent',
    note: versionNote(job, boards),
  });
  recordMissingAssets(
    deps.dataDir,
    runId,
    prepareRenderAssets(deps.db, deps.dataDir, runId, spec).missing,
  );
  return {
    specVersionId: saved.version.id,
    version: saved.version.version,
    beats: job.spec.story.beats.map((beat, i) => {
      const r = boards.records.get(i);
      return {
        beatId: beat.id,
        stepId: r?.stepId ?? null,
        outcome: r?.outcome ?? 'kept',
        retried: r?.retried ?? false,
      };
    }),
    warnings,
    usage: jobUsage(deps.db, runId, jobStepId),
  };
}

/** The pinned spec with every board and the beats' missing-primitive requests; no errors. */
function assembledSpec(job: GenerateJob, boards: Boards): VideoSpec {
  const spec = spliceBoards({ spec: job.spec, scenes: boards.scenes });
  const requests = uniqueRequests([
    ...spec.story.missingPrimitiveRequests,
    ...[...boards.records.values()].flatMap((r) => r.requests),
  ]);
  const withRequests = { ...spec, story: { ...spec.story, missingPrimitiveRequests: requests } };
  const result = withRegistryChecks(validateVideoSpec(withRequests), withRequests, job.registries);
  if (!result.ok) {
    throw new Error(`The spec with its boards is invalid:\n${formatSpecIssues(result.errors)}`);
  }
  return result.spec;
}

function uniqueRequests(requests: readonly MissingPrimitiveRequest[]): MissingPrimitiveRequest[] {
  const seen = new Map(requests.map((r) => [`${r.name}\u0000${r.fallbackUsed}`, r]));
  return [...seen.values()];
}

function versionNote(job: GenerateJob, boards: Boards): string {
  const drawn = [...boards.records.entries()]
    .filter(([, r]) => r.outcome === 'generated')
    .map(([i]) => job.spec.story.beats[i]?.id);
  const what = job.input.beatId
    ? `beat ${job.input.beatId} regenerated (drawn: ${drawn.join(', ') || 'none'})`
    : `${job.spec.story.beats.length} boards (${drawn.length} drawn)`;
  return `Boards from v${job.specVersion}: ${what}.`;
}

/** This job's Generator calls: every beat step it started has a larger id than its own step. */
function jobUsage(db: Db, runId: number, jobStepId: number): GenerateOutput['usage'] {
  const calls = listRunLlmCalls(db, runId).filter(
    (call) => call.role === 'generator' && call.stepId !== null && call.stepId > jobStepId,
  );
  return {
    calls: calls.length,
    costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
    inCached: calls.reduce((sum, call) => sum + call.tokensInCached, 0),
    inUncached: calls.reduce((sum, call) => sum + call.tokensInUncached, 0),
    out: calls.reduce((sum, call) => sum + call.tokensOut, 0),
  };
}

/** One log line: beats by outcome, the version, cost and cache hits, warnings left. */
export function summarize(output: GenerateOutput): string {
  const count = (outcome: string) => output.beats.filter((b) => b.outcome === outcome).length;
  const retried = output.beats.filter((b) => b.retried).length;
  const { calls, costUsd, inCached, inUncached, out } = output.usage;
  const input = inCached + inUncached;
  const hit = input > 0 ? Math.round((inCached / input) * 100) : 0;
  const n = (v: number) => v.toLocaleString('en-US');
  return (
    `Generator: ${output.beats.length} boards (${count('generated')} drawn, ` +
    `${count('reused')} reused, ${count('kept')} kept, ${retried} retried), spec v${output.version}. ` +
    `${calls} calls, $${costUsd.toFixed(4)}; cache hit ${n(inCached)} of ${n(input)} input ` +
    `tokens (${hit}%), ${n(out)} output. ${output.warnings.length} warnings for gate 3.`
  );
}

function formatSpecIssues(issues: readonly SpecError[]): string {
  return issues.map((e) => `  ${e.path} [${e.code}] ${e.message}`).join('\n');
}
