import {
  narrationWords,
  PROGRESS_DONE_PCT,
  ScriptwriterOutputSchema,
  wordBudgets,
  type DirectorPlan,
  type ResearchInput,
  type ResearchNotes,
  type ScriptwriterInput,
  type ScriptwriterOutput,
  type Stage,
  type TimingSettings,
  type VideoSettings,
} from '@explainer-studio/shared';
import { z } from 'zod';
import { scriptInputPath, scriptOutputPath, writeDataJson } from '#core/data-files.ts';
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
import { latestDirection } from '#core/services/direction.ts';
import { researchOfStep } from '#core/services/research-notes.ts';
import { activeStyleRules } from '#core/services/style-rules.ts';
import { buildPrompt } from '../agents/prompt-builder.ts';
import { resolvePromptVariables, type PromptVariables } from '../agents/prompt-variables.ts';
import type { PromptTemplates } from '../agents/prompts/templates.ts';
import { scriptwriterCheck } from '../agents/scriptwriter/check.ts';
import { scriptwriterUserMessage } from '../agents/scriptwriter/input.ts';
import { styleRulesSection } from '../agents/sections.ts';
import type { LlmClient } from '../llm/client.ts';
import { resolveTimingOptions } from '../timing/assemble.ts';
import { defineJobHandler, type JobContext, type JobHandler } from './handler.ts';

export const SCRIPT_JOB_TYPE = 'script' satisfies Stage;

export interface ScriptJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
  /**
   * App defaults; a run's `settings.video` (pace, level) and `settings.timing` (pauses)
   * override them.
   */
  readonly settings: { readonly video: VideoSettings; readonly timing: TimingSettings };
}

const PayloadSchema = z.strictObject({});
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

/** What a step reads besides its input file. */
interface ScriptContext {
  readonly run: Run;
  readonly series: Series;
  readonly topic: { readonly title: string; readonly notes: string | null };
  readonly plan: DirectorPlan;
  readonly notes: ResearchNotes;
  readonly research: ResearchInput;
  readonly variables: PromptVariables;
}

/**
 * The Scriptwriter (P1C.6): writes each beat's narration and on-screen text from the run's
 * latest Director plan and the research notes that plan was made from, and repairs the answer
 * until the schema and every check pass (`scriptwriterCheck`). Each attempt is its own
 * `run_steps` row (stage `script`) with its input and script files; the newest finished one is
 * `latestScript`. Assembling plan and script into a spec version is P1C.9's.
 */
export function scriptJobHandler(deps: ScriptJobDeps): JobHandler {
  return defineJobHandler({
    type: SCRIPT_JOB_TYPE,
    description: 'Write narration, headlines and on-screen text for each beat of the plan.',
    payloadSchema: PayloadSchema,
    run: (ctx) => script(deps, ctx),
  });
}

async function script(deps: ScriptJobDeps, ctx: Ctx): Promise<void> {
  const runId = ctx.job.runId;
  if (runId === null) throw new Error('A script job needs a run.');
  const run = getRun(deps.db, runId);
  if (!run) throw new NotFoundError('run', runId);
  if (failInterruptedSteps(deps.db, runId, SCRIPT_JOB_TYPE) > 0) {
    ctx.log('warn', 'An earlier Scriptwriter attempt was interrupted; starting a new one.');
  }
  const step = startRunStep(deps.db, { runId, stage: SCRIPT_JOB_TYPE });
  try {
    const { input, context } = prepare(deps, run);
    setRunStepInput(
      deps.db,
      step.id,
      writeDataJson(deps.dataDir, scriptInputPath(runId, step.id), input),
    );
    ctx.progress(10, 'Plan and notes loaded');

    const output = await writeScript(deps, ctx, step.id, input, context);
    finishRunStep(
      deps.db,
      step.id,
      writeDataJson(deps.dataDir, scriptOutputPath(runId, step.id), output),
    );
    ctx.log('info', summarize(output, input));
    ctx.progress(PROGRESS_DONE_PCT, 'Script ready');
  } catch (error) {
    failRunStep(deps.db, step.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function prepare(deps: ScriptJobDeps, run: Run) {
  const topic = getTopic(deps.db, run.topicId);
  if (!topic) throw new NotFoundError('topic', run.topicId);
  const series = getSeries(deps.db, run.seriesId);
  if (!series) throw new NotFoundError('series', run.seriesId);
  const direction = latestDirection(deps.db, deps.dataDir, run.id);
  if (!direction) throw new Error('The run has no finished plan: run the Director first.');
  const researchStepId = direction.input.researchStepId;
  const research = researchOfStep(deps.db, deps.dataDir, researchStepId);
  if (!research) {
    throw new Error(`The plan's research step ${researchStepId} has no finished notes.`);
  }
  const variables = resolvePromptVariables(run.settings, deps.settings.video);
  const { beatGapSec, landingSec } = resolveTimingOptions(run.settings, deps.settings.timing);
  const pauses = { beatGapSec, landingSec };
  const input: ScriptwriterInput = {
    directStepId: direction.step.id,
    researchStepId,
    explanationLevel: variables.explanationLevel,
    wordsPerSec: variables.wordsPerSec,
    pauses,
    budgets: wordBudgets(direction.plan, variables.wordsPerSec, pauses),
    styleRules: activeStyleRules(deps.db, 'scriptwriter'),
  };
  const context: ScriptContext = {
    run,
    series,
    topic: { title: topic.title, notes: topic.notes },
    plan: direction.plan,
    notes: research.notes,
    research: research.input,
    variables,
  };
  return { input, context };
}

async function writeScript(
  deps: ScriptJobDeps,
  ctx: Ctx,
  stepId: number,
  input: ScriptwriterInput,
  { run, series, topic, plan, notes, research, variables }: ScriptContext,
): Promise<ScriptwriterOutput> {
  const format = run.settings.format ?? plan.meta.format;
  const prompt = buildPrompt(deps.prompts, {
    role: 'scriptwriter',
    variables,
    styleRules: styleRulesSection(input.styleRules),
    input: scriptwriterUserMessage({
      topic,
      series: { name: series.name },
      level: input.explanationLevel,
      format,
      plan,
      notes,
      research,
      budgets: input.budgets,
    }),
  });
  const check = scriptwriterCheck({
    plan,
    notes,
    topicTitle: topic.title,
    level: input.explanationLevel,
    wordsPerSec: input.wordsPerSec,
    pauses: input.pauses,
    spec: {
      id: `run-${run.id}`,
      series: series.tag,
      ...(run.settings.format ? { formatOverride: run.settings.format } : {}),
    },
    hud: { seriesLabel: series.label, channelHandle: seriesChannelHandle(deps.db, series.id) },
  });
  const result = await deps.llm.callJson({
    role: 'scriptwriter',
    prompt,
    schema: ScriptwriterOutputSchema,
    runId: run.id,
    stepId,
    check,
    signal: ctx.signal,
    log: ctx.log,
  });
  return result.value;
}

/** One log line: beats, words against the budget, and the on-screen items. */
export function summarize(output: ScriptwriterOutput, input: ScriptwriterInput): string {
  const words = output.script.reduce((sum, b) => sum + narrationWords(b.narration).length, 0);
  const budget = input.budgets.reduce((sum, b) => sum + b.words, 0);
  const cards = output.script.reduce((sum, b) => sum + b.statCards.length, 0);
  const headlines = output.script.filter((b) => b.headline).length;
  return (
    `Script: ${output.script.length} beats, ${words} words (budget ${budget}), ` +
    `${headlines} headlines, ${cards} stat cards.`
  );
}
