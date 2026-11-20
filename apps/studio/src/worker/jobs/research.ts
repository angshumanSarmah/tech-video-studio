import {
  PROGRESS_DONE_PCT,
  ResearchNotesSchema,
  researchNotesProblems,
  type ResearchInput,
  type ResearchNotes,
  type ResearchSettings,
  type Stage,
  type VideoSettings,
} from '@explainer-studio/shared';
import { z } from 'zod';
import { researchInputPath, researchNotesPath, writeDataJson } from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import {
  failInterruptedSteps,
  failRunStep,
  finishRunStep,
  setRunStepInput,
  startRunStep,
} from '#core/db/repositories/run-steps.ts';
import { getRun, type Run } from '#core/db/repositories/runs.ts';
import { getSeries } from '#core/db/repositories/series.ts';
import { getTopic } from '#core/db/repositories/topics.ts';
import { NotFoundError } from '#core/errors.ts';
import { buildPrompt } from '../agents/prompt-builder.ts';
import { resolvePromptVariables } from '../agents/prompt-variables.ts';
import type { PromptTemplates } from '../agents/prompts/templates.ts';
import {
  buildResearchInput,
  citableChunks,
  describeSelection,
  researcherUserMessage,
} from '../agents/researcher/input.ts';
import { loadRunSources } from '../agents/researcher/load-sources.ts';
import type { LlmClient } from '../llm/client.ts';
import { defineJobHandler, type JobContext, type JobHandler } from './handler.ts';

export const RESEARCH_JOB_TYPE = 'research' satisfies Stage;

export interface ResearchJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
  /** App defaults; a run's `settings.video` overrides the prompt variables. */
  readonly settings: { readonly video: VideoSettings; readonly research: ResearchSettings };
}

const PayloadSchema = z.strictObject({});
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

/**
 * The Researcher (P1C.3): reads the chunks pinned to the run (within the source token budget),
 * asks the model for cited notes, and repairs them until the schema and the deterministic checks
 * pass (`researchNotesProblems`: no unknown chunk, no unsourced number). Each attempt is its own
 * `run_steps` row with its input (chunks sent and left out) and notes files, so a regeneration
 * never overwrites what gate 1 showed before.
 */
export function researchJobHandler(deps: ResearchJobDeps): JobHandler {
  return defineJobHandler({
    type: RESEARCH_JOB_TYPE,
    description: 'Write cited research notes from the run’s sources (gate 1 input).',
    payloadSchema: PayloadSchema,
    run: (ctx) => research(deps, ctx),
  });
}

async function research(deps: ResearchJobDeps, ctx: Ctx): Promise<void> {
  const runId = ctx.job.runId;
  if (runId === null) throw new Error('A research job needs a run.');
  const run = getRun(deps.db, runId);
  if (!run) throw new NotFoundError('run', runId);
  if (failInterruptedSteps(deps.db, runId, RESEARCH_JOB_TYPE) > 0) {
    ctx.log('warn', 'An earlier research attempt was interrupted; starting a new one.');
  }
  const step = startRunStep(deps.db, { runId, stage: RESEARCH_JOB_TYPE });
  try {
    const input = prepareInput(deps, run);
    setRunStepInput(
      deps.db,
      step.id,
      writeDataJson(deps.dataDir, researchInputPath(runId, step.id), input),
    );
    const selection = describeSelection(input);
    if (selection) ctx.log('warn', selection);
    ctx.progress(10, 'Sources selected');

    const notes = await writeNotes(deps, ctx, run, step.id, input);
    finishRunStep(
      deps.db,
      step.id,
      writeDataJson(deps.dataDir, researchNotesPath(runId, step.id), notes),
    );
    ctx.log('info', summarize(notes));
    ctx.progress(PROGRESS_DONE_PCT, 'Research notes ready');
  } catch (error) {
    failRunStep(deps.db, step.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function prepareInput(deps: ResearchJobDeps, run: Run): ResearchInput {
  const topic = getTopic(deps.db, run.topicId);
  if (!topic) throw new NotFoundError('topic', run.topicId);
  const series = getSeries(deps.db, run.seriesId);
  if (!series) throw new NotFoundError('series', run.seriesId);
  const sources = loadRunSources(deps.db, deps.dataDir, run.id, run.topicId);
  if (sources.length === 0) {
    throw new Error('The run has no extracted sources: run source ingestion first.');
  }
  return buildResearchInput({
    topic: { title: topic.title, notes: topic.notes },
    series: { name: series.name, label: series.label },
    sources,
    budgetTokens: deps.settings.research.sourceTokenBudget,
  });
}

async function writeNotes(
  deps: ResearchJobDeps,
  ctx: Ctx,
  run: Run,
  stepId: number,
  input: ResearchInput,
): Promise<ResearchNotes> {
  const prompt = buildPrompt(deps.prompts, {
    role: 'researcher',
    variables: resolvePromptVariables(run.settings, deps.settings.video),
    input: researcherUserMessage(input),
  });
  const chunks = citableChunks(input);
  const result = await deps.llm.callJson({
    role: 'researcher',
    prompt,
    schema: ResearchNotesSchema,
    runId: run.id,
    stepId,
    check: (notes) => researchNotesProblems(notes, chunks),
    signal: ctx.signal,
    log: ctx.log,
  });
  return result.value;
}

function summarize(notes: ResearchNotes): string {
  return (
    `Research notes: ${notes.facts.length} facts, ${notes.numbers.length} numbers, ` +
    `${notes.glossary.length} glossary terms, ${notes.analogies.length} analogies, ` +
    `${notes.failureModes.length} failure modes, ${notes.openQuestions.length} open questions.`
  );
}
