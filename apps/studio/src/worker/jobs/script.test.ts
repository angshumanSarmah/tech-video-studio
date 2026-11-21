import { join } from 'node:path';
import {
  narrationWords,
  ScriptwriterOutputSchema,
  SettingsSchema,
  type RunSettingsInput,
  type ScriptwriterOutput,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson } from '#core/data-files.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { enqueueJob, getJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { getRunStep } from '#core/db/repositories/run-steps.ts';
import { memoryRules } from '#core/db/schema.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { latestDirection } from '#core/services/direction.ts';
import { latestScript } from '#core/services/script.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { DIRECTOR_RESPONSES_DIR } from '../agents/director/testing.ts';
import { loadPromptTemplates, promptId, PROMPTS_DIR } from '../agents/prompts/templates.ts';
import {
  RATE_LIMITER_RESPONSES_DIR,
  RATE_LIMITER_SOURCE_FILES,
  RATE_LIMITER_TOPIC,
  seedRunWithUploads,
} from '../agents/researcher/testing.ts';
import { SCRIPTWRITER_RESPONSES_DIR } from '../agents/scriptwriter/testing.ts';
import { createLlmClient } from '../llm/client.ts';
import { dryRunTransport, loadDryRunFixtures, type DryRunResponse } from '../llm/dry-run.ts';
import { runNextJob } from '../runner.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from './direct.ts';
import { ingestJobHandler } from './ingest.ts';
import { createJobRegistry, type JobRegistry } from './registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from './research.ts';
import { SCRIPT_JOB_TYPE, scriptJobHandler, summarize } from './script.ts';

const prompts = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));
const settings = SettingsSchema.parse({});
const researcher = loadDryRunFixtures(RATE_LIMITER_RESPONSES_DIR).researcher!;
const director = loadDryRunFixtures(DIRECTOR_RESPONSES_DIR).director!;
const recorded = loadDryRunFixtures(SCRIPTWRITER_RESPONSES_DIR).scriptwriter!;

/**
 * The recording predates `source_label_bare`: its last answer cites a beat's source as the bare
 * library name "quotaflow". Until the fixture is re-recorded, the replay ends with the one repair
 * that check asks for (the publisher and what it is); once the recording has no bare name, this
 * adds nothing. TODO(re-record): drop it with the next `scriptwriter:fixture --record`.
 */
function withBareSourceRepair(responses: readonly DryRunResponse[]): DryRunResponse[] {
  const last = JSON.parse(responses.at(-1)!.content!) as { script: { source?: string }[] };
  const bare = last.script.filter((b) => b.source === 'quotaflow');
  if (bare.length === 0) return [...responses];
  for (const beat of bare) beat.source = 'quotaflow README';
  return [...responses, { content: JSON.stringify(last) }];
}

const scriptwriter = withBareSourceRepair(recorded);
const goodAnswer = scriptwriter.at(-1)!;
const goodScript = (): ScriptwriterOutput =>
  ScriptwriterOutputSchema.parse(JSON.parse(goodAnswer.content!));

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

function registry(scriptwriterResponses: readonly DryRunResponse[]): JobRegistry {
  const llm = createLlmClient({
    db: t.db,
    dataDir: t.dataDir,
    llm: settings.llm,
    transport: dryRunTransport({ researcher, director, scriptwriter: scriptwriterResponses }),
  });
  const deps = { db: t.db, dataDir: t.dataDir, llm, prompts, settings };
  return createJobRegistry([
    ingestJobHandler(deps),
    researchJobHandler(deps),
    directJobHandler(deps),
    scriptJobHandler(deps),
  ]);
}

async function runNext(reg: JobRegistry): Promise<void> {
  await runNextJob({
    db: t.db,
    registry: reg,
    workerId: 'test:1',
    signal: new AbortController().signal,
  });
}

/** Ingests the sources and replays the Researcher and the Director (unless `plan` is false). */
async function planned(reg: JobRegistry, runSettings?: RunSettingsInput, plan = true) {
  const { runId } = seedRunWithUploads(
    t.db,
    t.dataDir,
    RATE_LIMITER_TOPIC,
    RATE_LIMITER_SOURCE_FILES,
    { settings: runSettings },
  );
  await runNext(reg);
  expect(listRunJobs(t.db, runId)[0]!.status).toBe('done');
  enqueueJob(t.db, { type: RESEARCH_JOB_TYPE, runId });
  await runNext(reg);
  if (plan) {
    enqueueJob(t.db, { type: DIRECT_JOB_TYPE, runId });
    await runNext(reg);
    expect(latestDirection(t.db, t.dataDir, runId)).toBeDefined();
  }
  return runId;
}

async function write(reg: JobRegistry, runSettings?: RunSettingsInput) {
  const runId = await planned(reg, runSettings);
  const job = enqueueJob(t.db, { type: SCRIPT_JOB_TYPE, runId });
  await runNext(reg);
  return { runId, job: getJob(t.db, job.id)! };
}

function scriptCalls(runId: number) {
  return listRunLlmCalls(t.db, runId).filter((c) => c.role === 'scriptwriter');
}

function promptOf(promptPath: string) {
  return readDataJson(t.dataDir, promptPath) as { messages: { role: string; content: string }[] };
}

function logs(runId: number) {
  return listEventsSince(t.db, { runId, afterId: 0, limit: 500 })
    .filter((e) => e.type === 'log')
    .map((e) => e.payload as { level: string; message: string });
}

/** The good script with `mutate` applied, as a recorded answer. */
function answer(mutate: (script: ScriptwriterOutput) => void): DryRunResponse {
  const script = goodScript();
  mutate(script);
  return { content: JSON.stringify(script) };
}

describe('script job (rate-limiter fixture, dry run)', () => {
  it('writes a script that passes every check, from the plan and the notes it was made from', async () => {
    const { runId, job } = await write(registry(scriptwriter));
    expect(job.status).toBe('done');

    const result = latestScript(t.db, t.dataDir, runId)!;
    expect(result.step).toMatchObject({ stage: 'script', status: 'done', error: null });
    expect(result.output).toEqual(goodScript());
    const direction = latestDirection(t.db, t.dataDir, runId)!;
    expect(result.input).toMatchObject({
      directStepId: direction.step.id,
      researchStepId: direction.input.researchStepId,
      explanationLevel: 'beginner',
      wordsPerSec: 2.7,
      pauses: { beatGapSec: 0, landingSec: 0 },
      styleRules: [],
    });
    expect(result.input.budgets.map((b) => b.beatId)).toEqual(
      direction.plan.story.beats.map((b) => b.id),
    );
    expect(result.input.budgets[0]).toMatchObject({ targetSec: 8, words: 22, min: 18, max: 25 });

    const calls = scriptCalls(runId);
    // The recorded answers in order (repairs included), the last one passing.
    expect(calls).toHaveLength(scriptwriter.length);
    expect(calls.at(-1)).toMatchObject({
      error: null,
      model: settings.llm.models.scriptwriter,
      stepId: result.step.id,
      promptVersion: promptId('scriptwriter'),
    });
    expect(promptId('scriptwriter')).toBe('scriptwriter@v2');
    const [system, user] = promptOf(calls[0]!.promptPath).messages;
    expect(system!.content).toContain('Role: Scriptwriter.');
    expect(system!.content).toContain('## OUTPUT SHAPE');
    expect(system!.content).toContain('beginner level, and never use them before that beat');
    const message = user!.content;
    expect(message).toContain(direction.plan.story.runningExample!);
    expect(message).toContain('"wordBudget"');
    expect(message).toContain('"hookNumbers"');
    expect(message).toContain(
      'A bucket of permission tokens that refills at a fixed rate; each request spends one token.',
    );
    expect(message).toContain('"source": "A field guide to token-bucket rate limiting"');
    expect(message).not.toContain('source-1#chunk-1');

    expect(logs(runId).map((l) => l.message)).toContain(summarize(result.output, result.input));
  });

  it('repairs failed checks through the LLM client', async () => {
    const bad = answer(({ script }) => {
      script[0]!.narration = 'Checkout sent its provider far too much traffic. The limiter was on.';
      script[1]!.headline = { text: 'Resets let 900 extra through', semantic: 'problem' };
      script[2]!.statCards = [{ value: '100 tokens', label: 'capacity', sourceRef: 'num-99' }];
      script[2]!.narration += ' An atomic script would not help.';
      script[6]!.tags = ['A TAG FAR TOO LONG FOR ITS LITTLE BOX'];
    });
    const { runId, job } = await write(registry([bad, goodAnswer]));
    expect(job.status).toBe('done');

    const calls = scriptCalls(runId);
    expect(calls.map((c) => c.error)).toEqual([expect.stringMatching(/^Invalid output/), null]);
    const repair = promptOf(calls[1]!.promptPath).messages.at(-1)!.content;
    for (const expected of [
      '$.script[0].narration: Beat "b1" has 12 words',
      'The hook never says num-',
      '$.script[1].headline.text',
      '$.script[2].statCards[0].sourceRef',
      'Beat "b3" uses "atomic script" before beat "b4" introduces it',
      '$.script[6].tags[0]',
    ]) {
      expect(repair).toContain(expected);
    }
  });

  it('checks headlines as the HUD draws them', async () => {
    const long = answer(({ script }) => {
      script[3]!.headline = {
        text: 'Atomic script = one read, refill and write that no other gateway node can ever split apart',
        semantic: 'concept',
      };
    });
    const { runId } = await write(registry([long, goodAnswer]));
    const repair = promptOf(scriptCalls(runId)[1]!.promptPath).messages.at(-1)!.content;
    expect(repair).toMatch(/\$\.script\[3\]\.headline\.text: .*\(about \d+ characters\)/);
  });

  it('fails the step and the job when the script is still invalid after every repair', async () => {
    const bad = answer(({ script }) => script.pop());
    const { runId, job } = await write(registry([bad, bad, bad]));
    expect(job.status).toBe('failed');
    expect(job.error).toContain('scriptwriter output is still invalid after 2 repair attempts');
    expect(latestScript(t.db, t.dataDir, runId)).toBeUndefined();
    const step = getRunStep(t.db, scriptCalls(runId)[0]!.stepId!)!;
    expect(step).toMatchObject({ stage: 'script', status: 'failed' });
    expect(step.inputPath).not.toBeNull();
  });

  it('needs a finished plan', async () => {
    const reg = registry(scriptwriter);
    const runId = await planned(reg, undefined, false);
    const job = enqueueJob(t.db, { type: SCRIPT_JOB_TYPE, runId });
    await runNext(reg);
    expect(getJob(t.db, job.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('no finished plan') as string,
    });
    expect(scriptCalls(runId)).toEqual([]);
  });

  it('applies the run’s pace, pauses and level, and the scriptwriter’s style rules', async () => {
    t.db
      .insert(memoryRules)
      .values([
        { scope: 'scriptwriter', text: '<example-script-rule>', status: 'active' },
        { scope: 'all', text: '<example-shared-rule>', status: 'active' },
        { scope: 'director', text: '<example-director-rule>', status: 'active' },
        { scope: 'scriptwriter', text: '<example-proposed-rule>', status: 'proposed' },
      ])
      .run();
    // A slower pace and a beat gap shrink every budget, so the good script fails and is repaired.
    const { runId } = await write(registry([goodAnswer, goodAnswer, goodAnswer]), {
      video: { wordsPerSec: 2, explanationLevel: 'expert' },
      timing: { beatGapSec: 1 },
    });
    const step = scriptCalls(runId)[0]!.stepId!;
    const input = readDataJson(t.dataDir, getRunStep(t.db, step)!.inputPath!) as {
      styleRules: string[];
      budgets: { beatId: string; narrationSec: number; words: number }[];
      explanationLevel: string;
    };
    expect(input.styleRules).toEqual(['<example-script-rule>', '<example-shared-rule>']);
    expect(input.explanationLevel).toBe('expert');
    expect(input.budgets[0]).toMatchObject({ narrationSec: 7, words: 14 });
    expect(input.budgets.at(-1)).toMatchObject({ narrationSec: 10, words: 20 });

    const [system] = promptOf(scriptCalls(runId)[0]!.promptPath).messages;
    expect(system!.content).toContain('- <example-script-rule>');
    expect(system!.content).not.toContain('<example-director-rule>');
    const repair = promptOf(scriptCalls(runId)[1]!.promptPath).messages.at(-1)!.content;
    const firstWords = narrationWords(goodScript().script[0]!.narration).length;
    expect(repair).toContain(
      `$.script[0].narration: Beat "b1" has ${firstWords} words; its budget is 12-16`,
    );
  });
});
