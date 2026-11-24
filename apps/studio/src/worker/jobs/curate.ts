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
  type CuratorReport,
  type LlmUsage,
  type RenderableVideoSpec,
  type ResearchNotes,
  type Stage,
  type TimingSettings,
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
import { directorMemory } from '#core/services/director-memory.ts';
import { latestDirection } from '#core/services/direction.ts';
import { researchOfStep } from '#core/services/research-notes.ts';
import { pinnedSpecVersion } from '#core/services/spec-versions.ts';
import { reviewSpec, type ReviewResult } from '../agents/curator/review.ts';
import { resolvePromptVariables, type PromptVariables } from '../agents/prompt-variables.ts';
import type { PromptTemplates } from '../agents/prompts/templates.ts';
import type { LlmClient } from '../llm/client.ts';
import { resolveTimingOptions } from '../timing/assemble.ts';
import { defineJobHandler, type JobContext, type JobHandler } from './handler.ts';

export const CURATE_JOB_TYPE = 'curate' satisfies Stage;

export interface CurateJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
  readonly settings: {
    readonly video: VideoSettings;
    readonly timing: TimingSettings;
    readonly llm: { readonly models: { readonly curator: string } };
  };
}

const PayloadSchema = z.strictObject({ specVersionId: z.number().int().positive() });
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

/**
 * The Curator (P1C.8), review only: the code checks (`curatorCodeChecks`) and the model's review
 * of the pinned spec version, which should be the re-timed spec after the Generator. One
 * `run_steps` row per job (stage `curate`) with `curate/input-<step>.json` and
 * `curate/report-<step>.json` (`CuratorReportSchema`); the newest finished one is
 * `latestCuration`, gate 3's input. A spec that fails validation gets its errors and no review.
 * The repair loop comes later (P1C.8 steps 8-9).
 */
export function curateJobHandler(deps: CurateJobDeps): JobHandler {
  return defineJobHandler({
    type: CURATE_JOB_TYPE,
    description: 'Check and review the finished spec: code checks, then the Curator model.',
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
    const codeIssues = curatorCodeChecks(job.spec, job.checks);
    ctx.progress(20, `Code checks: ${codeIssues.length} finding(s)`);
    const review = job.valid
      ? await reviewSpec(
          {
            llm: deps.llm,
            prompts: deps.prompts,
            variables: job.variables,
            registries: job.checks.registries ?? DEFAULT_REGISTRIES,
            runId,
            stepId: step.id,
            signal: ctx.signal,
            log: ctx.log,
          },
          {
            spec: job.spec,
            notes: job.checks.notes,
            level: job.input.explanationLevel,
            codeIssues,
          },
        )
      : undefined;
    if (!job.valid)
      ctx.log('warn', 'The spec has validation errors: no review until they are fixed.');
    const report = buildReport(deps.db, runId, job.input, codeIssues, review);
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
  const variables = resolvePromptVariables(run.settings, deps.settings.video);
  return {
    spec,
    valid: validated.ok,
    variables,
    input: {
      specVersionId: pinned.id,
      version: pinned.version,
      directStepId: direction.step.id,
      researchStepId,
      model: deps.settings.llm.models.curator,
      explanationLevel: variables.explanationLevel,
    },
    checks: checkContext(deps, run, research.notes, research.input.sources, variables, ctx),
  };
}

function checkContext(
  deps: CurateJobDeps,
  run: Run,
  notes: ResearchNotes,
  sources: Parameters<typeof bareSourceNames>[0] & CuratorCheckContext['sources'],
  video: VideoSettings,
  ctx: Ctx,
): CuratorCheckContext {
  const topic = getTopic(deps.db, run.topicId);
  if (!topic) throw new NotFoundError('topic', run.topicId);
  const series = getSeries(deps.db, run.seriesId);
  if (!series) throw new NotFoundError('series', run.seriesId);
  const { beatGapSec, landingSec } = resolveTimingOptions(run.settings, deps.settings.timing);
  const { recent } = directorMemory(deps.db, run.id);
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
    recent: { combos: recent.combos, patterns: recent.patterns },
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
  codeIssues: readonly CodeIssue[],
  review: ReviewResult | undefined,
): CuratorReport {
  const blocking =
    codeIssues.some((i) => i.severity === 'blocking') ||
    (review?.issues.some((i) => i.severity === 'blocking') ?? false);
  return {
    specVersionId: input.specVersionId,
    version: input.version,
    explanationLevel: input.explanationLevel,
    codeIssues: [...codeIssues],
    review: review
      ? {
          issues: review.issues,
          dropped: review.dropped,
          capped: review.capped,
          ...(review.previous ? { previous: review.previous } : {}),
          usage: usageOf(db, runId, review.callIds),
        }
      : null,
    blocking,
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

/** One log line: findings by source and severity, what was dropped, the cost. */
export function summarize(report: CuratorReport): string {
  const blocking = (list: readonly { severity: string }[]) =>
    list.filter((i) => i.severity === 'blocking').length;
  const code = `${report.codeIssues.length} code finding(s) (${blocking(report.codeIssues)} blocking)`;
  if (!report.review) return `Curator on v${report.version}: ${code}; not reviewed (invalid spec).`;
  const { issues, dropped, capped, usage } = report.review;
  return (
    `Curator on v${report.version}: ${code}; review ${issues.length} issue(s) ` +
    `(${blocking(issues)} blocking), ${dropped.length} dropped, ${capped} capped; ` +
    `${usage.calls} call(s), $${usage.costUsd.toFixed(4)}. ` +
    (report.blocking ? 'Blocking issues: gate 3 waits.' : 'Nothing blocking.')
  );
}
