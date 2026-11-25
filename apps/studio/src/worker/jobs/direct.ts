import { directorCatalogueBlock, titleRoomChars } from '@explainer-studio/renderer/catalog';
import { getTheme } from '@explainer-studio/renderer/theme';
import {
  DirectorPlanSchema,
  PROGRESS_DONE_PCT,
  storyCatalogueVersions,
  type DirectorInput,
  type DirectorPlan,
  type ResearchNotes,
  type ResearchSource,
  type Stage,
} from '@explainer-studio/shared';
import { z } from 'zod';
import { directInputPath, directPlanPath, writeDataJson } from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import {
  failInterruptedSteps,
  failRunStep,
  finishRunStep,
  setRunStepInput,
  startRunStep,
} from '#core/db/repositories/run-steps.ts';
import { getRun, type Run } from '#core/db/repositories/runs.ts';
import { getSeries, seriesChannelHandle, type Series } from '#core/db/repositories/series.ts';
import { getTopic } from '#core/db/repositories/topics.ts';
import { NotFoundError } from '#core/errors.ts';
import { directorMemory, nextSeriesNumber } from '#core/services/director-memory.ts';
import { latestResearch } from '#core/services/research-notes.ts';
import { planCheckDeps } from '#core/checks/plan.ts';
import { directorCheck } from '../agents/director/check.ts';
import { directorUserMessage } from '../agents/director/input.ts';
import { styleRulesSection } from '../agents/sections.ts';
import { buildPrompt } from '../agents/prompt-builder.ts';
import { type PromptVariables } from '../agents/prompt-variables.ts';
import type { PromptTemplates } from '../agents/prompts/templates.ts';
import type { LlmClient } from '../llm/client.ts';
import { defineJobHandler, type JobContext, type JobHandler } from './handler.ts';

export const DIRECT_JOB_TYPE = 'direct' satisfies Stage;

export interface DirectJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
  /**
   * Reference breakdowns for this run (prompt section 4, structure only). Retrieval is P1C.11;
   * until then no section is sent.
   */
  readonly references?: (input: DirectorInput) => string | undefined;
}

const PayloadSchema = z.strictObject({});
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

/** What a step reads besides its input file: the notes and the HUD's run context. */
interface DirectContext {
  readonly run: Run;
  readonly series: Series;
  readonly notes: ResearchNotes;
  /** The research step's sources: their site and library names are bare as source lines. */
  readonly sources: readonly ResearchSource[];
  readonly variables: PromptVariables;
}

/**
 * The Director (P1C.5): plans the video from the run's latest research notes, its memory (style
 * rules, recent usage, past topics) and the summaries-only catalogue, and repairs the plan until
 * the schema and every check pass (`directorCheck`). Each attempt is its own `run_steps` row
 * (stage `direct`) with its input and plan files; the newest finished one is gate 2's input
 * (`latestDirection`). Turning the plan into spec versions (and parts into runs) is P1C.9's.
 */
export function directJobHandler(deps: DirectJobDeps): JobHandler {
  let catalogue: string | undefined;
  const catalogueBlock = () => (catalogue ??= directorCatalogueBlock());
  return defineJobHandler({
    type: DIRECT_JOB_TYPE,
    description: 'Plan the video’s story and beats from the research notes (gate 2 input).',
    payloadSchema: PayloadSchema,
    run: (ctx) => direct(deps, catalogueBlock, ctx),
  });
}

async function direct(deps: DirectJobDeps, catalogue: () => string, ctx: Ctx): Promise<void> {
  const runId = ctx.job.runId;
  if (runId === null) throw new Error('A direct job needs a run.');
  const run = getRun(deps.db, runId);
  if (!run) throw new NotFoundError('run', runId);
  if (failInterruptedSteps(deps.db, runId, DIRECT_JOB_TYPE) > 0) {
    ctx.log('warn', 'An earlier Director attempt was interrupted; starting a new one.');
  }
  const step = startRunStep(deps.db, { runId, stage: DIRECT_JOB_TYPE });
  try {
    const { input, context } = prepare(deps, run);
    setRunStepInput(
      deps.db,
      step.id,
      writeDataJson(deps.dataDir, directInputPath(runId, step.id), input),
    );
    ctx.progress(10, 'Notes and memory loaded');

    const plan = await writePlan(deps, ctx, catalogue(), step.id, input, context);
    finishRunStep(
      deps.db,
      step.id,
      writeDataJson(deps.dataDir, directPlanPath(runId, step.id), plan),
    );
    for (const line of summarize(plan)) ctx.log('info', line);
    ctx.progress(PROGRESS_DONE_PCT, 'Beat sheet ready');
  } catch (error) {
    failRunStep(deps.db, step.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function prepare(deps: DirectJobDeps, run: Run): { input: DirectorInput; context: DirectContext } {
  const topic = getTopic(deps.db, run.topicId);
  if (!topic) throw new NotFoundError('topic', run.topicId);
  const series = getSeries(deps.db, run.seriesId);
  if (!series) throw new NotFoundError('series', run.seriesId);
  const research = latestResearch(deps.db, deps.dataDir, run.id);
  if (!research) throw new Error('The run has no finished research: run the Researcher first.');
  const variables = run.resolvedSettings.video;
  const input: DirectorInput = {
    topic: { title: topic.title, notes: topic.notes },
    series: {
      tag: series.tag,
      name: series.name,
      label: series.label,
      nextNumber: nextSeriesNumber(deps.db, series.id),
    },
    length: {
      ...(run.settings.lengthOverrideSec === undefined
        ? {}
        : { overrideSec: run.settings.lengthOverrideSec }),
      minSec: variables.lengthMinSec,
      maxSec: variables.lengthMaxSec,
      reasonAboveSec: variables.lengthReasonAboveSec,
    },
    parts: { allowed: variables.allowParts, max: variables.maxParts },
    explanationLevel: variables.explanationLevel,
    ...(run.settings.format === undefined ? {} : { formatOverride: run.settings.format }),
    researchStepId: research.step.id,
    memory: directorMemory(deps.db, run.id),
    catalogueVersions: storyCatalogueVersions(),
    titleMaxChars: titleRoomChars(getTheme(), series.label),
  };
  return {
    input,
    context: { run, series, notes: research.notes, sources: research.input.sources, variables },
  };
}

async function writePlan(
  deps: DirectJobDeps,
  ctx: Ctx,
  catalogue: string,
  stepId: number,
  input: DirectorInput,
  { run, series, notes, sources, variables }: DirectContext,
): Promise<DirectorPlan> {
  const prompt = buildPrompt(deps.prompts, {
    role: 'director',
    variables,
    catalogue,
    references: deps.references?.(input),
    styleRules: styleRulesSection(input.memory.styleRules),
    input: directorUserMessage(input, notes),
  });
  const check = directorCheck(
    planCheckDeps({
      runId: run.id,
      input,
      notes,
      sources,
      video: variables,
      series,
      channelHandle: seriesChannelHandle(deps.db, series.id),
    }),
  );
  const result = await deps.llm.callJson({
    role: 'director',
    prompt,
    schema: DirectorPlanSchema,
    runId: run.id,
    stepId,
    check,
    signal: ctx.signal,
    log: ctx.log,
  });
  return result.value;
}

/** Log lines: the plan's shape, then any missing-primitive requests. */
export function summarize(plan: DirectorPlan): string[] {
  const { story, meta } = plan;
  const length = plan.parts
    ? plan.parts.map((p) => `part ${p.part}: ${p.targetLengthSec} s`).join(', ')
    : `${meta.targetLengthSec ?? '?'} s`;
  const lines = [
    `Beat sheet: ${story.beats.length} beats in ${story.chapters.length} chapters, ${length}, ` +
      `format ${meta.format}, topic class ${meta.topicClass}, ending ${story.ending.kind}.`,
  ];
  for (const request of story.missingPrimitiveRequests) {
    lines.push(`Missing primitive: ${request.name} (fallback ${request.fallbackUsed}).`);
  }
  return lines;
}
