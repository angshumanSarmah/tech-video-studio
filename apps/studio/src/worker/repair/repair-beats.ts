import type { Registries } from '@explainer-studio/renderer/catalog';
import {
  bareSourceNames,
  measuredBeatLengths,
  planOfSpec,
  remapAnchors,
  ScriptwriterOutputSchema,
  validateRenderableVideoSpec,
  wordBudgets,
  type BeatScene,
  type BeatScript,
  type DirectorPlan,
  type LlmSettings,
  type LlmUsage,
  type LogLevel,
  type RenderableVideoSpec,
  type RepairOutput,
  type RepairRequest,
  type ResearchInput,
  type ResearchNotes,
  type TimingSettings,
  type TtsSettings,
  type VideoSettings,
  type VideoSpec,
} from '@explainer-studio/shared';
import { z } from 'zod';
import {
  readDataJson,
  repairInputPath,
  repairOutputPath,
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
import { latestDirection } from '#core/services/direction.ts';
import { researchOfStep } from '#core/services/research-notes.ts';
import { pinnedSpecVersion, saveSpecVersion } from '#core/services/spec-versions.ts';
import { activeStyleRules } from '#core/services/style-rules.ts';
import type { BeatStepContext } from '../agents/generator/beat-step.ts';
import { placeholderScene } from '../agents/generator/board.ts';
import { beatAncestors, beatDependents } from '../agents/generator/schedule.ts';
import { buildPrompt } from '../agents/prompt-builder.ts';
import { resolvePromptVariables, type PromptVariables } from '../agents/prompt-variables.ts';
import type { PromptTemplates } from '../agents/prompts/templates.ts';
import { styleRulesSection } from '../agents/sections.ts';
import type { ScriptwriterCheckDeps } from '../agents/scriptwriter/check.ts';
import type { ScriptwriterMessage } from '../agents/scriptwriter/input.ts';
import { reviseCheck, reviseUserMessage, spliceRevision } from '../agents/scriptwriter/revise.ts';
import {
  assetRegistries,
  beatBoardIssues,
  generatorStepContext,
  redrawBeat,
  redrawDependents,
} from '../jobs/generate.ts';
import { formatIssues, LlmOutputInvalidError, type LlmClient } from '../llm/client.ts';
import type { OutputIssue } from '../llm/types.ts';
import { resolveTimingOptions } from '../timing/assemble.ts';
import { synthesizeScript, timedSpec } from '../timing/narrate.ts';
import { timeNarration, type NarratedBeat } from '../timing/step.ts';
import { resolveTtsOptions, type TtsOptions } from '../tts/options.ts';
import type { TtsProvider } from '../tts/provider.ts';
import { inputHash, subStep, type StepScope } from './steps.ts';

/**
 * Repairing single beats of a finished spec (P1C.8 step 8; the Curator's repair loop and a gate's
 * "regenerate beat N" use it). In order:
 * 1. each Scriptwriter request: the beat revised in beat mode (`scriptwriter/revise.ts`), only
 *    its allowed fields taken (`repair_scope`);
 * 2. narration: every beat synthesised (unchanged beats are cache hits);
 * 3. each beat whose narration changed: its board's anchors remapped onto the new words
 *    (`remapAnchors`); a beat that lost an anchored word gets a placeholder board for now;
 * 4. boards, on an interim spec timed without its new boards' holds: a beat whose anchors could
 *    not move, with a Generator request, or whose remapped board fails its checks is drawn again
 *    (the regenerate path), then the later beats of its board that no longer pass; a remapped
 *    board's later beats are checked the same way. Generator requests' issues are its feedback;
 * 5. the spec re-timed (landing holds from the final boards) and saved as one version.
 * Beats not named keep their script and board byte for byte. One `run_steps` row for the repair
 * (stage `repair`) and one per sub-step (`steps.ts`): a repair run again with the same requests
 * reuses every finished step (and the Generator's beat steps), so a crash costs only the
 * unfinished part. Intermediate states live in step files; only the final spec is a version.
 */

export interface RepairDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
  readonly tts: TtsProvider;
  readonly settings: {
    readonly video: VideoSettings;
    readonly timing: TimingSettings;
    readonly tts: TtsSettings;
    readonly llm: Pick<LlmSettings, 'models'>;
  };
}

export interface RepairArgs {
  readonly runId: number;
  readonly specVersionId: number;
  readonly requests: readonly RepairRequest[];
  readonly signal: AbortSignal;
  readonly log: (level: LogLevel, message: string) => void;
}

export interface RepairResult extends RepairOutput {
  /** The repair's own `run_steps` row. */
  readonly stepId: number;
}

/** Everything a repair reads, loaded once. */
interface RepairContext {
  readonly run: Run;
  readonly spec: RenderableVideoSpec;
  readonly version: number;
  readonly plan: DirectorPlan;
  readonly notes: ResearchNotes;
  readonly research: ResearchInput;
  readonly variables: PromptVariables;
  readonly pauses: TimingSettings;
  readonly ttsOptions: TtsOptions;
  readonly registries: Registries;
  readonly topic: { readonly title: string; readonly notes: string | null };
  readonly series: { readonly name: string; readonly label: string; readonly tag: string };
  readonly channelHandle: string | null;
}

export async function repairBeats(deps: RepairDeps, args: RepairArgs): Promise<RepairResult> {
  const run = getRun(deps.db, args.runId);
  if (!run) throw new NotFoundError('run', args.runId);
  if (failInterruptedSteps(deps.db, run.id, 'repair') > 0) {
    args.log('warn', 'An earlier repair was interrupted; its finished steps are reused.');
  }
  const parent = startRunStep(deps.db, { runId: run.id, stage: 'repair' });
  try {
    const ctx = prepare(deps, run, args);
    setRunStepInput(
      deps.db,
      parent.id,
      writeDataJson(deps.dataDir, repairInputPath(run.id, parent.id), {
        specVersionId: args.specVersionId,
        version: ctx.version,
        requests: args.requests,
      }),
    );
    const output = await repair(deps, args, ctx, parent.id);
    finishRunStep(
      deps.db,
      parent.id,
      writeDataJson(deps.dataDir, repairOutputPath(run.id, parent.id), output),
    );
    args.log('info', summarize(output, ctx.version));
    return { ...output, stepId: parent.id };
  } catch (error) {
    failRunStep(deps.db, parent.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function prepare(deps: RepairDeps, run: Run, args: RepairArgs): RepairContext {
  const pinned = pinnedSpecVersion(deps.db, run.id, args.specVersionId);
  const validated = validateRenderableVideoSpec(readDataJson(deps.dataDir, pinned.jsonPath));
  if (!validated.ok)
    throw new Error(`Spec v${pinned.version} is not renderable: repair needs boards.`);
  const direction = latestDirection(deps.db, deps.dataDir, run.id);
  if (!direction) throw new Error('The run has no finished plan.');
  const research = researchOfStep(deps.db, deps.dataDir, direction.input.researchStepId);
  if (!research) throw new Error("The plan's research step has no finished notes.");
  const topic = getTopic(deps.db, run.topicId);
  if (!topic) throw new NotFoundError('topic', run.topicId);
  const series = getSeries(deps.db, run.seriesId);
  if (!series) throw new NotFoundError('series', run.seriesId);
  return {
    run,
    spec: validated.spec,
    version: pinned.version,
    plan: planOfSpec(validated.spec),
    notes: research.notes,
    research: research.input,
    variables: resolvePromptVariables(run.settings, deps.settings.video),
    pauses: resolveTimingOptions(run.settings, deps.settings.timing),
    ttsOptions: resolveTtsOptions(run.settings, deps.settings.tts),
    registries: assetRegistries(deps.db, deps.dataDir, args.log),
    topic: { title: topic.title, notes: topic.notes },
    series: { name: series.name, label: series.label, tag: series.tag },
    channelHandle: seriesChannelHandle(deps.db, series.id),
  };
}

type Outcome = RepairOutput['beats'][number];

async function repair(
  deps: RepairDeps,
  args: RepairArgs,
  ctx: RepairContext,
  parentId: number,
): Promise<RepairOutput> {
  const scope: StepScope = { db: deps.db, dataDir: deps.dataDir, runId: ctx.run.id };
  const before = ctx.spec.script;
  let script: BeatScript[] = [...before];
  for (const req of args.requests.filter((r) => r.owner === 'scriptwriter')) {
    script = await revise(deps, args, ctx, scope, req, script);
  }
  const narrated = await narrate(deps, args, ctx, scope, script);
  const changed = new Set(
    script.filter((s, i) => s.narration !== before[i]?.narration).map((s) => s.beatId),
  );
  const remaps = await remapBoards(scope, ctx, script, changed);
  const interim = interimSpec(ctx, script, narrated, remaps);
  const outcomes = new Map<string, Outcome>();
  const scenes = await redrawBoards(deps, args, ctx, interim, remaps, outcomes, script);
  const final = timedSpec(
    deps.dataDir,
    ctx.run.id,
    { ...ctx.spec, script, scenes },
    narrated,
    ctx.pauses,
  );
  const saved = saveSpecVersion(deps.db, deps.dataDir, {
    runId: ctx.run.id,
    spec: final.spec,
    createdBy: 'agent',
    note: versionNote(ctx.version, outcomes),
  });
  return {
    specVersionId: saved.version.id,
    version: saved.version.version,
    created: saved.created,
    beats: outcomesOf(before, script, outcomes),
    usage: repairUsage(deps.db, ctx.run.id, parentId),
  };
}

// --- 1. The Scriptwriter, one beat at a time ---------------------------------------------------

async function revise(
  deps: RepairDeps,
  args: RepairArgs,
  ctx: RepairContext,
  scope: StepScope,
  req: RepairRequest,
  script: BeatScript[],
): Promise<BeatScript[]> {
  const budgets = wordBudgets(ctx.plan, ctx.variables.wordsPerSec, ctx.pauses);
  const base: ScriptwriterMessage = {
    topic: ctx.topic,
    series: { name: ctx.series.name },
    level: ctx.variables.explanationLevel,
    format: ctx.spec.meta.format,
    plan: ctx.plan,
    notes: ctx.notes,
    research: ctx.research,
    budgets,
  };
  const measured = measuredBeatLengths(ctx.spec).find((b) => b.beatId === req.beatId);
  const styleRules = styleRulesSection(activeStyleRules(deps.db, 'scriptwriter'));
  const prompt = buildPrompt(deps.prompts, {
    role: 'scriptwriter',
    variables: ctx.variables,
    ...(styleRules ? { styleRules } : {}),
    input: reviseUserMessage(base, script, req, measured),
  });
  const model = deps.settings.llm.models.scriptwriter;
  const hash = inputHash({ model, versions: prompt.versions, messages: prompt.messages, req });
  const step = await subStep(
    scope,
    { beatId: req.beatId, kind: 'script', hash, input: req, output: ScriptwriterOutputSchema },
    async (stepId) =>
      (
        await deps.llm.callJson({
          role: 'scriptwriter',
          prompt,
          schema: ScriptwriterOutputSchema,
          runId: ctx.run.id,
          stepId,
          check: reviseCheck(checkDeps(ctx), script, req),
          signal: args.signal,
          log: args.log,
        })
      ).value,
  );
  const revised = step.value.script[0];
  if (!revised) throw new Error(`The Scriptwriter returned no beat ${req.beatId}.`);
  if (step.reused)
    args.log('info', `Beat ${req.beatId}: the revision from step ${step.stepId} is reused.`);
  return spliceRevision(script, req, revised);
}

function checkDeps(ctx: RepairContext): ScriptwriterCheckDeps {
  return {
    plan: ctx.plan,
    notes: ctx.notes,
    topicTitle: ctx.topic.title,
    sourceNames: bareSourceNames(ctx.research.sources),
    sources: ctx.research.sources,
    level: ctx.variables.explanationLevel,
    wordsPerSec: ctx.variables.wordsPerSec,
    pauses: { beatGapSec: ctx.pauses.beatGapSec, landingSec: ctx.pauses.landingSec },
    spec: {
      id: ctx.spec.meta.id,
      series: ctx.spec.meta.series,
      formatOverride: ctx.spec.meta.format,
      ...(ctx.spec.story.ending.seriesNumber !== undefined
        ? { seriesNumber: ctx.spec.story.ending.seriesNumber }
        : {}),
    },
    hud: { seriesLabel: ctx.series.label, channelHandle: ctx.channelHandle },
  };
}

// --- 2. Narration -------------------------------------------------------------------------------

const NarratedSchema = z.strictObject({
  durationSec: z.number(),
  words: z.number().int(),
});

/** Every beat synthesised (cache hits for unchanged ones); a step per changed narration. */
async function narrate(
  deps: RepairDeps,
  args: RepairArgs,
  ctx: RepairContext,
  scope: StepScope,
  script: readonly BeatScript[],
): Promise<NarratedBeat[]> {
  const beats = await synthesizeScript(deps.tts, script, ctx.ttsOptions, args.signal);
  for (const [i, beat] of script.entries()) {
    if (beat.narration === ctx.spec.script[i]?.narration) continue;
    const narrated = beats[i];
    if (!narrated) continue;
    const { voice, speed } = ctx.ttsOptions;
    await subStep(
      scope,
      {
        beatId: beat.beatId,
        kind: 'narrate',
        hash: inputHash({ text: beat.narration, voice, speed }),
        input: { text: beat.narration, voice, speed },
        output: NarratedSchema,
      },
      () => ({ durationSec: narrated.durationSec, words: narrated.words.length }),
    );
  }
  return beats;
}

// --- 3. Anchors ---------------------------------------------------------------------------------

const RemapSchema = z.union([
  z.strictObject({ ok: z.literal(true), scene: z.unknown(), moved: z.number().int() }),
  z.strictObject({
    ok: z.literal(false),
    lost: z.array(
      z.strictObject({ path: z.array(z.union([z.string(), z.number()])), word: z.string() }),
    ),
  }),
]);

type Remap =
  | { ok: true; scene: BeatScene; moved: number }
  | { ok: false; lost: { path: (string | number)[]; word: string }[] };

/** Each changed beat's board on its new words, or the anchored words it lost. */
async function remapBoards(
  scope: StepScope,
  ctx: RepairContext,
  script: readonly BeatScript[],
  changed: ReadonlySet<string>,
): Promise<Map<string, Remap>> {
  const out = new Map<string, Remap>();
  for (const [i, beat] of script.entries()) {
    if (!changed.has(beat.beatId)) continue;
    const scene = ctx.spec.scenes[i];
    const oldNarration = ctx.spec.script[i]?.narration ?? '';
    if (!scene) continue;
    const step = await subStep(
      scope,
      {
        beatId: beat.beatId,
        kind: 'remap',
        hash: inputHash({ oldNarration, newNarration: beat.narration, scene }),
        input: { oldNarration, newNarration: beat.narration },
        output: RemapSchema,
      },
      () => remapAnchors(scene, oldNarration, beat.narration),
    );
    out.set(beat.beatId, step.value as Remap);
  }
  return out;
}

/**
 * The spec the boards are drawn on: the new script, remapped boards (placeholders where the
 * anchors were lost), timed on the new narration without the new boards' landing holds.
 */
function interimSpec(
  ctx: RepairContext,
  script: BeatScript[],
  narrated: readonly NarratedBeat[],
  remaps: ReadonlyMap<string, Remap>,
): VideoSpec {
  const scenes = ctx.spec.story.beats.map((beat, i) => {
    const remap = remaps.get(beat.id);
    if (!remap) return ctx.spec.scenes[i]!;
    return remap.ok ? remap.scene : placeholderScene(beat);
  });
  const spec: VideoSpec = { ...ctx.spec, script, scenes };
  const timed = timeNarration(spec, narrated, ctx.pauses);
  return {
    ...spec,
    timing: { audioFile: ctx.spec.timing?.audioFile ?? 'pending.wav', ...timed.timing },
  };
}

// --- 4. Boards ----------------------------------------------------------------------------------

async function redrawBoards(
  deps: RepairDeps,
  args: RepairArgs,
  ctx: RepairContext,
  spec: VideoSpec,
  remaps: ReadonlyMap<string, Remap>,
  outcomes: Map<string, Outcome>,
  script: readonly BeatScript[],
): Promise<BeatScene[]> {
  const c: BeatStepContext = generatorStepContext(deps, {
    runId: ctx.run.id,
    runSettings: ctx.run.settings,
    notes: ctx.notes,
    registries: ctx.registries,
    signal: args.signal,
    log: args.log,
  });
  const salt = `repair-${inputHash({ specVersionId: args.specVersionId, requests: args.requests })}`;
  const beats = spec.story.beats;
  let scenes = [...(spec.scenes ?? [])];
  const mark = (indexes: readonly number[], board: Outcome['board']) => {
    for (const j of indexes) {
      const id = beats[j]?.id;
      if (id) outcomes.set(id, { ...(outcomes.get(id) ?? base(id)), board });
    }
  };
  const scriptChanged = new Set(
    script
      .filter((s, i) => JSON.stringify(s) !== JSON.stringify(ctx.spec.script[i]))
      .map((s) => s.beatId),
  );
  for (const [i, beat] of beats.entries()) {
    const remap = remaps.get(beat.id);
    const generator = args.requests.filter((r) => r.owner === 'generator' && r.beatId === beat.id);
    if (!remap && generator.length === 0 && !scriptChanged.has(beat.id)) continue;
    const feedback = [
      ...(remap && !remap.ok
        ? [
            `The narration changed and these anchored words are gone: ${remap.lost.map((l) => `"${l.word}"`).join(', ')}. Draw the board for the new narration.`,
          ]
        : []),
      ...generator.flatMap((r) => r.issues.map((i) => `- [${i.code}] ${i.message}`)),
    ];
    if (feedback.length === 0) {
      const gained = gainedIssues(c, ctx, { spec, scenes, index: i });
      const after = await keptOrRedrawn(c, { spec, scenes, index: i, gained, salt, log: args.log });
      scenes = after.scenes;
      if (remap?.ok && !after.drawn.includes(i)) mark([i], 'remapped');
      mark(after.drawn, 'redrawn');
      continue;
    }
    const after = await redrawBeat(c, {
      spec,
      scenes,
      index: i,
      feedback: feedback.join('\n'),
      salt,
    });
    scenes = after.scenes;
    mark(after.drawn, 'redrawn');
    if (remap && !remap.ok) {
      outcomes.set(beat.id, {
        ...(outcomes.get(beat.id) ?? base(beat.id)),
        lost: remap.lost.map((l) => l.word),
      });
    }
  }
  return scenes;
}

const base = (beatId: string): Outcome => ({ beatId, script: 'kept', board: 'kept' });

const issueKey = (issue: OutputIssue) => `${issue.code ?? ''}|${issue.path}`;

/**
 * The issues a beat's board has on the repaired narration that it did not have before the
 * repair (advisory ones included): what the new words broke, not what was already accepted.
 */
function gainedIssues(
  c: BeatStepContext,
  ctx: RepairContext,
  now: { readonly spec: VideoSpec; readonly scenes: readonly BeatScene[]; readonly index: number },
): OutputIssue[] {
  const had = new Set(beatBoardIssues(c, ctx.spec, ctx.spec.scenes, now.index).map(issueKey));
  return beatBoardIssues(c, now.spec, now.scenes, now.index).filter((i) => !had.has(issueKey(i)));
}

/**
 * A board that kept its drawing (anchors remapped, or a script change around it): when it gained
 * issues it is drawn once more with them as feedback; if the Generator cannot clear them, the
 * board stays as it was and the issues go to the gate (the Curator's code checks find them
 * again). Then the later beats of its board that no longer pass are redrawn.
 */
async function keptOrRedrawn(
  c: BeatStepContext,
  req: {
    readonly spec: VideoSpec;
    readonly scenes: readonly BeatScene[];
    readonly index: number;
    readonly gained: readonly OutputIssue[];
    readonly salt: string;
    readonly log: RepairArgs['log'];
  },
): Promise<{ scenes: BeatScene[]; drawn: number[] }> {
  const { spec, scenes, index } = req;
  if (req.gained.length > 0) {
    try {
      const feedback = `The narration changed and the board no longer passes:\n${formatIssues(req.gained)}`;
      return await redrawBeat(c, { spec, scenes, index, feedback, salt: req.salt });
    } catch (error) {
      if (!(error instanceof LlmOutputInvalidError)) throw error;
      const beatId = spec.story.beats[index]?.id ?? String(index);
      const codes = [...new Set(req.gained.map((i) => i.code ?? i.path))].join(', ');
      req.log('warn', `Beat ${beatId}: the redraw did not clear ${codes}; the board is kept.`);
    }
  }
  return redrawDependents(c, { spec, scenes, index });
}

// --- 5. Result ----------------------------------------------------------------------------------

function outcomesOf(
  before: readonly BeatScript[],
  after: readonly BeatScript[],
  boards: ReadonlyMap<string, Outcome>,
): Outcome[] {
  return after.flatMap((beat, i) => {
    const old = before[i];
    const revised = JSON.stringify(beat) !== JSON.stringify(old);
    const board = boards.get(beat.beatId);
    if (!revised && !board) return [];
    return [
      {
        ...(board ?? base(beat.beatId)),
        beatId: beat.beatId,
        script: revised ? 'revised' : 'kept',
        ...(old && old.narration !== beat.narration
          ? { narration: { before: old.narration, after: beat.narration } }
          : {}),
      },
    ];
  });
}

/** This repair's calls: the Scriptwriter's and the Generator's, on steps after its own row. */
function repairUsage(db: Db, runId: number, parentId: number): LlmUsage {
  const calls = listRunLlmCalls(db, runId).filter(
    (c) =>
      (c.role === 'scriptwriter' || c.role === 'generator') &&
      c.stepId !== null &&
      c.stepId > parentId,
  );
  const sum = (pick: (c: (typeof calls)[number]) => number) =>
    calls.reduce((t, c) => t + pick(c), 0);
  return {
    calls: calls.length,
    costUsd: sum((c) => c.costUsd),
    inCached: sum((c) => c.tokensInCached),
    inUncached: sum((c) => c.tokensInUncached),
    out: sum((c) => c.tokensOut),
    reasoning: sum((c) => c.tokensReasoning),
  };
}

function versionNote(version: number, outcomes: ReadonlyMap<string, Outcome>): string {
  const boards = [...outcomes.values()].map((o) => `${o.beatId} ${o.board}`).join(', ');
  return `Repaired from v${version}${boards ? `: boards ${boards}` : ''}.`;
}

function summarize(output: RepairOutput, version: number): string {
  const beats = output.beats
    .map((b) => `${b.beatId} (script ${b.script}, board ${b.board})`)
    .join(', ');
  const saved = output.created ? `saved v${output.version}` : `unchanged, kept v${output.version}`;
  return (
    `Repair of v${version}: ${beats || 'nothing changed'}; ${saved}; ` +
    `${output.usage.calls} call(s), $${output.usage.costUsd.toFixed(4)}.`
  );
}

// --- Keep-best: putting beats back -----------------------------------------------------------

/**
 * Beats put back as they were in an earlier version (`best`), with every beat on their boards
 * (a board's beats share one layout), and the spec re-timed and saved as the run's next version.
 * The Curator's loop does this for a beat a round left with more blocking issues than before.
 */
export async function restoreBeats(
  deps: RepairDeps,
  args: {
    readonly runId: number;
    readonly current: VideoSpec;
    readonly best: VideoSpec;
    readonly beatIds: readonly string[];
    readonly signal: AbortSignal;
  },
): Promise<{ specVersionId: number; version: number; beatIds: string[] }> {
  const run = getRun(deps.db, args.runId);
  if (!run) throw new NotFoundError('run', args.runId);
  const beats = args.current.story.beats;
  const group = new Set<number>();
  for (const id of args.beatIds) {
    const i = beats.findIndex((b) => b.id === id);
    if (i < 0) continue;
    for (const j of [...beatAncestors(args.current, i), i, ...beatDependents(args.current, i)]) {
      group.add(j);
    }
  }
  const ids = [...group].sort((a, b) => a - b).map((i) => beats[i]!.id);
  const pick = <T extends { beatId: string }>(now: readonly T[], before: readonly T[]) =>
    now.map((item) =>
      ids.includes(item.beatId) ? (before.find((b) => b.beatId === item.beatId) ?? item) : item,
    );
  const spec: VideoSpec = {
    ...args.current,
    script: pick(args.current.script ?? [], args.best.script ?? []),
    scenes: pick(args.current.scenes ?? [], args.best.scenes ?? []),
  };
  const options = resolveTtsOptions(run.settings, deps.settings.tts);
  const pauses = resolveTimingOptions(run.settings, deps.settings.timing);
  const narrated = await synthesizeScript(deps.tts, spec.script ?? [], options, args.signal);
  const timed = timedSpec(deps.dataDir, run.id, spec, narrated, pauses);
  const saved = saveSpecVersion(deps.db, deps.dataDir, {
    runId: run.id,
    spec: timed.spec,
    createdBy: 'agent',
    note: `Restored ${ids.join(', ')} as they were before the last repair round.`,
  });
  return { specVersionId: saved.version.id, version: saved.version.version, beatIds: ids };
}
