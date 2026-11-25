import {
  buildAssetRegistry,
  curatorCodeChecks,
  DEFAULT_REGISTRIES,
  type CuratorCheckContext,
  type Registries,
} from '@explainer-studio/renderer/catalog';
import { getTheme } from '@explainer-studio/renderer/theme';
import {
  bareSourceNames,
  PROGRESS_DONE_PCT,
  validateRenderableVideoSpec,
  type CodeIssue,
  type CurateInput,
  type CurateRound,
  type CuratorIssue,
  type CuratorReport,
  type RepairOutput,
  type RepairRequest,
  type LlmUsage,
  type RenderableVideoSpec,
  type ResearchNotes,
  type Stage,
  type VideoSettings,
} from '@explainer-studio/shared';
import { z } from 'zod';
import { loadAssetLibrary } from '#core/assets/library.ts';
import {
  curateInputPath,
  curateReportPath,
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
import { getRun, type Run } from '#core/db/repositories/runs.ts';
import { getSeries, seriesChannelHandle } from '#core/db/repositories/series.ts';
import { getTopic } from '#core/db/repositories/topics.ts';
import { NotFoundError } from '#core/errors.ts';
import { recentUsage } from '#core/services/director-memory.ts';
import { latestDirection } from '#core/services/direction.ts';
import { latestCuration } from '#core/services/curation.ts';
import { researchOfStep } from '#core/services/research-notes.ts';
import { getSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { pinnedSpecVersion } from '#core/services/spec-versions.ts';
import type { CuratorRound } from '../agents/curator/input.ts';
import {
  blockingKeys,
  blockingPerBeat,
  gateBadges,
  mergeRoundReview,
  numbered,
  repairRequests,
} from '../agents/curator/loop.ts';
import { reviewSpec, type ReviewResult } from '../agents/curator/review.ts';
import { type PromptVariables } from '../agents/prompt-variables.ts';
import type { PromptTemplates } from '../agents/prompts/templates.ts';
import { LlmOutputInvalidError, type LlmClient } from '../llm/client.ts';
import { repairBeats, restoreBeats } from '../repair/repair-beats.ts';
import type { TtsProvider } from '../tts/provider.ts';
import { defineJobHandler, type JobContext, type JobHandler } from './handler.ts';

export const CURATE_JOB_TYPE = 'curate' satisfies Stage;

export interface CurateJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
  /** Repairs narrate changed beats (unchanged ones are cache hits). */
  readonly tts: TtsProvider;
}

/** Repair rounds a curate job runs at most. */
export const MAX_REPAIR_ROUNDS = 2;

const PayloadSchema = z.strictObject({
  specVersionId: z.number().int().positive(),
  /** Run the repair loop (default); false reviews only (the fixture scripts' recorded reviews). */
  repair: z.boolean().default(true),
  /**
   * A scoped curate (after a gate's "regenerate beat", P1C.9): the review covers only the beats
   * that changed since this version (the one the last curation ended on), the earlier issues on
   * the others carry over, and only the changed beats are repaired.
   */
  scope: z.strictObject({ sinceSpecVersionId: z.number().int().positive() }).optional(),
});
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

/**
 * The Curator (P1C.8): code checks and the two-pass review of the pinned spec version (the
 * re-timed spec after the Generator), then the repair loop. Each round sends every repairable
 * blocking issue (the Scriptwriter's or the Generator's, on a beat) to `repairBeats`, runs the
 * code checks on the repaired version and a scoped review (new issues only on the beats the round
 * changed; issues on the others carry over), puts back a beat that came out with more blocking
 * issues than it had (keep-best, `restoreBeats`), and stops when nothing blocking is left, when
 * nothing left is repairable, when a round leaves the same blocking set, or after
 * `MAX_REPAIR_ROUNDS`. The Director's and the Researcher's issues go to the gate unrepaired,
 * marked as needing a plan change. One `run_steps` row per job (stage `curate`):
 * `curate/input-<step>.json` and `curate/report-<step>.json` (`CuratorReportSchema`: the final
 * version, its code issues and review, every round, why it stopped, gate 3's badges and blocking
 * flag, the cost); `latestCuration` is gate 3's read. A spec that fails validation gets its errors
 * and no review.
 */
export function curateJobHandler(deps: CurateJobDeps): JobHandler {
  return defineJobHandler({
    type: CURATE_JOB_TYPE,
    description:
      'Check and review the finished spec, then repair blocking issues (at most 2 rounds).',
    payloadSchema: PayloadSchema,
    run: (ctx) => curate(deps, ctx),
  });
}

async function curate(deps: CurateJobDeps, ctx: Ctx): Promise<void> {
  const runId = ctx.job.runId;
  if (runId === null) throw new Error('A curate job needs a run.');
  const run = getRun(deps.db, runId);
  if (!run) throw new NotFoundError('run', runId);
  if (failInterruptedSteps(deps.db, runId, CURATE_JOB_TYPE) > 0) {
    ctx.log('warn', 'An earlier curate job was interrupted; starting a new review.');
  }
  const step = startRunStep(deps.db, { runId, stage: CURATE_JOB_TYPE });
  try {
    const job = prepare(deps, run, ctx);
    setRunStepInput(
      deps.db,
      step.id,
      writeDataJson(deps.dataDir, curateInputPath(runId, step.id), job.input),
    );
    const report = await curateLoop(deps, ctx, job, runId, step.id);
    finishRunStep(
      deps.db,
      step.id,
      writeDataJson(deps.dataDir, curateReportPath(runId, step.id), report),
    );
    ctx.log('info', summarize(report));
    ctx.progress(PROGRESS_DONE_PCT, 'Review ready');
  } catch (error) {
    failRunStep(deps.db, step.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** Where the loop stands: the current version, its code issues and the review's issues. */
interface Standing {
  readonly spec: RenderableVideoSpec;
  readonly specVersionId: number;
  readonly version: number;
  readonly code: CodeIssue[];
  readonly issues: CuratorIssue[];
}

async function curateLoop(
  deps: CurateJobDeps,
  ctx: Ctx,
  job: CurateJob,
  runId: number,
  stepId: number,
): Promise<CuratorReport> {
  const checks = (spec: RenderableVideoSpec) => curatorCodeChecks(spec, job.checks);
  const reviews: ReviewResult[] = [];
  const review = async (spec: RenderableVideoSpec, code: CodeIssue[], round?: CuratorRound) => {
    const result = await reviewSpec(
      {
        llm: deps.llm,
        prompts: deps.prompts,
        variables: job.variables,
        registries: job.checks.registries ?? DEFAULT_REGISTRIES,
        runId,
        stepId,
        signal: ctx.signal,
        log: ctx.log,
      },
      {
        spec,
        notes: job.checks.notes,
        level: job.input.explanationLevel,
        codeIssues: code,
        ...(round ? { round } : {}),
      },
    );
    reviews.push(result);
    return result;
  };
  const firstCode = checks(job.spec);
  ctx.progress(10, `Code checks: ${firstCode.length} finding(s)`);
  const scope = job.valid ? scopeOf(deps, ctx, runId, job.spec) : undefined;
  const firstIssues = async (): Promise<CuratorIssue[]> => {
    if (!job.valid) return [];
    if (!scope) return (await review(job.spec, firstCode)).issues;
    const earlier = scope.previous.review?.issues ?? [];
    if (scope.changed.size === 0) return earlier;
    const result = await review(job.spec, firstCode, {
      previous: numbered(earlier),
      changedBeatIds: [...scope.changed],
    });
    return mergeRoundReview(earlier, result, scope.changed);
  };
  let now: Standing = {
    spec: job.spec,
    specVersionId: job.input.specVersionId,
    version: job.input.version,
    code: firstCode,
    issues: await firstIssues(),
  };
  const rounds: CurateRound[] = [];
  let stop: CuratorReport['stop'] = job.valid
    ? ctx.payload.repair
      ? 'clean'
      : 'repair_off'
    : 'invalid_spec';
  if (!job.valid)
    ctx.log('warn', 'The spec has validation errors: no review until they are fixed.');
  for (let round = 1; job.valid && ctx.payload.repair && round <= MAX_REPAIR_ROUNDS; round += 1) {
    const requests = repairRequests(now.spec, now.code, now.issues).filter(
      (r) => !scope || scope.changed.has(r.beatId),
    );
    const before = blockingKeys(now.spec, now.code, now.issues);
    if (requests.length === 0) {
      stop = before.length > 0 ? 'nothing_repairable' : 'clean';
      break;
    }
    ctx.progress(20 + round * 30, `Repair round ${round}: ${requests.length} request(s)`);
    const repaired = await repairRound(deps, ctx, now, requests, runId);
    if (!repaired) {
      stop = 'repair_failed';
      break;
    }
    const next = await reviewRound(deps, ctx, now, repaired, runId, checks, review);
    rounds.push({
      round,
      requests,
      repair: repaired.output,
      restored: next.restored,
      blockingBefore: before,
      blockingAfter: blockingKeys(next.standing.spec, next.standing.code, next.standing.issues),
    });
    now = next.standing;
    const after = rounds.at(-1)!.blockingAfter;
    if (after.length === 0) {
      stop = 'clean';
      break;
    }
    if (after.join() === before.join()) {
      stop = 'no_progress';
      break;
    }
    stop = 'max_rounds';
  }
  const report = buildReport(deps.db, runId, job.input, now, reviews, rounds, stop);
  if (!scope) return report;
  return {
    ...report,
    review: report.review ?? scope.previous.review,
    scope: {
      sinceSpecVersionId: scope.since,
      changedBeatIds: [...scope.changed],
    },
  };
}

interface Scope {
  readonly since: number;
  /** The report of the curation that ended on `since`. */
  readonly previous: CuratorReport;
  /** Beats whose script or board differ from `since`. */
  readonly changed: ReadonlySet<string>;
}

/** The payload's scope, with what it needs; undefined (logged) when it cannot be scoped. */
function scopeOf(
  deps: CurateJobDeps,
  ctx: Ctx,
  runId: number,
  spec: RenderableVideoSpec,
): Scope | undefined {
  const since = ctx.payload.scope?.sinceSpecVersionId;
  if (since === undefined) return undefined;
  const previous = latestCuration(deps.db, deps.dataDir, runId)?.report;
  if (previous?.final.specVersionId !== since) {
    ctx.log('warn', `No curation ended on spec version ${since}: reviewing every beat.`);
    return undefined;
  }
  const before = loadSpec(deps, since);
  return { since, previous, changed: changedBeats(before, spec) };
}

/** Beats whose script entry or board differ between two versions. */
export function changedBeats(before: RenderableVideoSpec, after: RenderableVideoSpec): Set<string> {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const find = <T extends { beatId: string }>(list: readonly T[], id: string) =>
    list.find((x) => x.beatId === id);
  return new Set(
    after.story.beats
      .map((b) => b.id)
      .filter(
        (id) =>
          !same(find(before.script, id), find(after.script, id)) ||
          !same(find(before.scenes, id), find(after.scenes, id)),
      ),
  );
}

/** One repair; undefined (logged) when an agent could not produce a valid fix. */
async function repairRound(
  deps: CurateJobDeps,
  ctx: Ctx,
  now: Standing,
  requests: RepairRequest[],
  runId: number,
): Promise<{ output: RepairOutput; spec: RenderableVideoSpec } | undefined> {
  try {
    const result = await repairBeats(
      { ...deps },
      { runId, specVersionId: now.specVersionId, requests, signal: ctx.signal, log: ctx.log },
    );
    const output: RepairOutput = {
      specVersionId: result.specVersionId,
      version: result.version,
      created: result.created,
      beats: result.beats,
      usage: result.usage,
    };
    return { output, spec: loadSpec(deps, result.specVersionId) };
  } catch (error) {
    if (!(error instanceof LlmOutputInvalidError)) throw error;
    ctx.log('warn', `A repair could not be made (${error.role}); the issues go to the gate.`);
    return undefined;
  }
}

/**
 * After a repair: the code checks and a scoped review on the repaired version, merged with what
 * carries over; then keep-best: a changed beat that came out with more blocking issues than it
 * had is put back (with its board) and keeps its earlier issues.
 */
async function reviewRound(
  deps: CurateJobDeps,
  ctx: Ctx,
  now: Standing,
  repaired: { output: RepairOutput; spec: RenderableVideoSpec },
  runId: number,
  checks: (spec: RenderableVideoSpec) => CodeIssue[],
  review: (
    spec: RenderableVideoSpec,
    code: CodeIssue[],
    round?: CuratorRound,
  ) => Promise<ReviewResult>,
): Promise<{ standing: Standing; restored: string[] }> {
  const changed = new Set(
    repaired.output.beats
      .filter((b) => b.script === 'revised' || b.board !== 'kept')
      .map((b) => b.beatId),
  );
  const code = checks(repaired.spec);
  const second = await review(repaired.spec, code, {
    previous: numbered(now.issues),
    changedBeatIds: [...changed],
  });
  const issues = mergeRoundReview(now.issues, second, changed);
  const was = blockingPerBeat(now.spec, now.code, now.issues);
  const is = blockingPerBeat(repaired.spec, code, issues);
  const worse = [...changed].filter((id) => (is.get(id) ?? 0) > (was.get(id) ?? 0));
  const standing: Standing = {
    spec: repaired.spec,
    specVersionId: repaired.output.specVersionId,
    version: repaired.output.version,
    code,
    issues,
  };
  if (worse.length === 0) return { standing, restored: [] };
  const restored = await restoreBeats(deps, {
    runId,
    current: repaired.spec,
    best: now.spec,
    beatIds: worse,
    signal: ctx.signal,
  });
  ctx.log('warn', `Beats ${restored.beatIds.join(', ')} came out worse: put back as they were.`);
  const spec = loadSpec(deps, restored.specVersionId);
  const back = new Set(restored.beatIds);
  return {
    standing: {
      spec,
      specVersionId: restored.specVersionId,
      version: restored.version,
      code: checks(spec),
      issues: [
        ...issues.filter((i) => !back.has(i.beatId)),
        ...now.issues.filter((i) => back.has(i.beatId)),
      ],
    },
    restored: restored.beatIds,
  };
}

function loadSpec(deps: CurateJobDeps, specVersionId: number): RenderableVideoSpec {
  const version = getSpecVersion(deps.db, specVersionId);
  if (!version) throw new Error(`Spec version ${specVersionId} does not exist.`);
  const result = validateRenderableVideoSpec(readDataJson(deps.dataDir, version.jsonPath));
  if (!result.ok) throw new Error(`Spec v${version.version} is not renderable.`);
  return result.spec;
}

interface CurateJob {
  readonly spec: RenderableVideoSpec;
  readonly valid: boolean;
  readonly input: CurateInput;
  readonly checks: CuratorCheckContext;
  readonly variables: PromptVariables;
}

function prepare(deps: CurateJobDeps, run: Run, ctx: Ctx): CurateJob {
  const pinned = pinnedSpecVersion(deps.db, run.id, ctx.payload.specVersionId);
  const raw = readDataJson(deps.dataDir, pinned.jsonPath);
  const validated = validateRenderableVideoSpec(raw);
  // An invalid spec still gets its code checks (they report the errors); they validate it again.
  const spec = (validated.ok ? validated.spec : raw) as RenderableVideoSpec;
  if (validated.ok && !spec.timing) {
    ctx.log('warn', 'The spec has no timing yet: lengths are not measured, timing is estimated.');
  }
  const direction = latestDirection(deps.db, deps.dataDir, run.id);
  if (!direction) throw new Error('The run has no finished plan: run the Director first.');
  const researchStepId = direction.input.researchStepId;
  const research = researchOfStep(deps.db, deps.dataDir, researchStepId);
  if (!research) {
    throw new Error(`The plan's research step ${researchStepId} has no finished notes.`);
  }
  const variables = run.resolvedSettings.video;
  const { videos, combos, patterns, structures } = recentUsage(deps.db, run.id);
  const recent = { videos, combos, patterns, structures };
  return {
    spec,
    valid: validated.ok,
    variables,
    input: {
      specVersionId: pinned.id,
      version: pinned.version,
      directStepId: direction.step.id,
      researchStepId,
      model: run.resolvedSettings.llm.models.curator,
      explanationLevel: variables.explanationLevel,
      recent,
    },
    checks: checkContext(deps, run, research.notes, research.input.sources, variables, ctx, recent),
  };
}

function checkContext(
  deps: CurateJobDeps,
  run: Run,
  notes: ResearchNotes,
  sources: Parameters<typeof bareSourceNames>[0] & CuratorCheckContext['sources'],
  video: VideoSettings,
  ctx: Ctx,
  recent: CuratorCheckContext['recent'],
): CuratorCheckContext {
  const topic = getTopic(deps.db, run.topicId);
  if (!topic) throw new NotFoundError('topic', run.topicId);
  const series = getSeries(deps.db, run.seriesId);
  if (!series) throw new NotFoundError('series', run.seriesId);
  const { beatGapSec, landingSec } = run.resolvedSettings.timing;
  return {
    theme: getTheme(),
    registries: libraryRegistries(deps, ctx),
    notes,
    topicTitle: topic.title,
    series: { name: series.name, label: series.label },
    channelHandle: seriesChannelHandle(deps.db, series.id),
    video,
    ...(run.settings.lengthOverrideSec !== undefined
      ? { lengthOverrideSec: run.settings.lengthOverrideSec }
      : {}),
    pauses: { beatGapSec, landingSec },
    recent,
    sourceNames: bareSourceNames(sources),
    sources,
  };
}

/** The registries with the DB's approved assets, as the Generator drew with. */
function libraryRegistries(deps: CurateJobDeps, ctx: Ctx): Registries {
  const library = loadAssetLibrary(deps.db, deps.dataDir);
  for (const p of library.problems) ctx.log('warn', `Asset ${p.id} is left out: ${p.message}`);
  return { ...DEFAULT_REGISTRIES, assets: buildAssetRegistry(library.assets) };
}

function buildReport(
  db: Db,
  runId: number,
  input: CurateInput,
  now: Standing,
  reviews: readonly ReviewResult[],
  rounds: readonly CurateRound[],
  stop: CuratorReport['stop'],
): CuratorReport {
  const last = reviews.at(-1);
  const blocking =
    now.code.some((i) => i.severity === 'blocking') ||
    now.issues.some((i) => i.severity === 'blocking');
  const reviewUsage = usageOf(
    db,
    runId,
    reviews.flatMap((r) => [...r.calls.claims, ...r.calls.story]),
  );
  const repairUsd = rounds.reduce((sum, r) => sum + r.repair.usage.costUsd, 0);
  return {
    specVersionId: input.specVersionId,
    version: input.version,
    final: { specVersionId: now.specVersionId, version: now.version },
    explanationLevel: input.explanationLevel,
    codeIssues: now.code,
    review: last
      ? {
          issues: now.issues,
          dropped: reviews.flatMap((r) => r.dropped),
          capped: reviews.reduce((sum, r) => sum + r.capped, 0),
          ...(last.previous ? { previous: last.previous } : {}),
          claims: last.claims,
          coverage: last.coverage,
          calls: {
            claims: reviews.reduce((sum, r) => sum + r.calls.claims.length, 0),
            story: reviews.reduce((sum, r) => sum + r.calls.story.length, 0),
          },
          usage: reviewUsage,
        }
      : null,
    rounds: [...rounds],
    stop,
    badges: gateBadges(now.spec, now.code, now.issues),
    blocking,
    cost: {
      reviewUsd: reviewUsage.costUsd,
      repairUsd,
      totalUsd: reviewUsage.costUsd + repairUsd,
    },
  };
}

function usageOf(db: Db, runId: number, callIds: readonly number[]): LlmUsage {
  const ids = new Set(callIds);
  const calls = listRunLlmCalls(db, runId).filter((c) => ids.has(c.id));
  const sum = (pick: (c: (typeof calls)[number]) => number) =>
    calls.reduce((total, c) => total + pick(c), 0);
  return {
    calls: calls.length,
    costUsd: sum((c) => c.costUsd),
    inCached: sum((c) => c.tokensInCached),
    inUncached: sum((c) => c.tokensInUncached),
    out: sum((c) => c.tokensOut),
    reasoning: sum((c) => c.tokensReasoning),
  };
}

/** One log line: the rounds, what is left, the cost. */
export function summarize(report: CuratorReport): string {
  const blocking = report.badges.filter((b) => b.severity === 'blocking').length;
  const plan = report.badges.filter((b) => b.needsPlanChange).length;
  const rounds = report.rounds
    .map((r) => {
      const beats = r.repair.beats.map((b) => `${b.beatId} ${b.board}`).join(', ');
      const back = r.restored.length > 0 ? `; put back ${r.restored.join(', ')}` : '';
      return `round ${r.round}: ${r.requests.length} request(s) (${beats}${back})`;
    })
    .join('; ');
  return (
    `Curator: v${report.version} -> v${report.final.version}; ${rounds || 'no repairs'}; ` +
    `stopped: ${report.stop}. Left for gate 3: ${report.badges.length} issue(s), ${blocking} ` +
    `blocking, ${plan} needing a plan change. $${report.cost.totalUsd.toFixed(4)} ` +
    `(review $${report.cost.reviewUsd.toFixed(4)}, repairs $${report.cost.repairUsd.toFixed(4)}).`
  );
}
