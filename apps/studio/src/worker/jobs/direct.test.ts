import { join } from 'node:path';
import {
  deviceLayoutCombo,
  DirectorPlanSchema,
  TOPIC_CLASS_CATALOGUE,
  SettingsSchema,
  type DirectorPlan,
  type RunSettingsInput,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson } from '#core/data-files.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { recordExport } from '#core/db/repositories/exports.ts';
import { enqueueJob, getJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { getRunStep } from '#core/db/repositories/run-steps.ts';
import { createRun } from '#core/db/repositories/runs.ts';
import { listSeries } from '#core/db/repositories/series.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { memoryRules, usageHistory } from '#core/db/schema.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { latestDirection } from '#core/services/direction.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { DIRECTOR_RESPONSES_DIR, withExampleNumbersRepair } from '../agents/director/testing.ts';
import { loadPromptTemplates, promptId, PROMPTS_DIR } from '../agents/prompts/templates.ts';
import {
  RATE_LIMITER_RESPONSES_DIR,
  RATE_LIMITER_SOURCE_FILES,
  RATE_LIMITER_TOPIC,
  seedRunWithUploads,
} from '../agents/researcher/testing.ts';
import { createLlmClient } from '../llm/client.ts';
import { dryRunTransport, loadDryRunFixtures, type DryRunResponse } from '../llm/dry-run.ts';
import { runNextJob } from '../runner.ts';
import { DIRECT_JOB_TYPE, directJobHandler, summarize } from './direct.ts';
import { ingestJobHandler } from './ingest.ts';
import { createJobRegistry, type JobRegistry } from './registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from './research.ts';

const prompts = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));
const settings = SettingsSchema.parse({});
/** The Researcher v2 fixture: every recorded attempt, so the replay ends on the passing notes. */
const researcher = loadDryRunFixtures(RATE_LIMITER_RESPONSES_DIR).researcher!;
const director = withExampleNumbersRepair(loadDryRunFixtures(DIRECTOR_RESPONSES_DIR).director!);
const goodAnswer = director.at(-1)!;
const goodPlan = (): DirectorPlan => DirectorPlanSchema.parse(JSON.parse(goodAnswer.content!));

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

function registry(directorResponses: readonly DryRunResponse[]): JobRegistry {
  const llm = createLlmClient({
    db: t.db,
    dataDir: t.dataDir,
    llm: settings.llm,
    transport: dryRunTransport({ researcher, director: directorResponses }),
  });
  const deps = { db: t.db, dataDir: t.dataDir, llm, prompts, settings };
  return createJobRegistry([
    ingestJobHandler(deps),
    researchJobHandler(deps),
    directJobHandler(deps),
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

/** Ingests the rate-limiter sources, replays the recorded research, then runs the Director. */
async function direct(reg: JobRegistry, runSettings?: RunSettingsInput) {
  const { runId } = seedRunWithUploads(
    t.db,
    t.dataDir,
    RATE_LIMITER_TOPIC,
    RATE_LIMITER_SOURCE_FILES,
    {
      settings: runSettings,
    },
  );
  await runNext(reg);
  expect(listRunJobs(t.db, runId)[0]!.status).toBe('done');
  enqueueJob(t.db, { type: RESEARCH_JOB_TYPE, runId });
  await runNext(reg);
  const job = enqueueJob(t.db, { type: DIRECT_JOB_TYPE, runId });
  await runNext(reg);
  return { runId, job: getJob(t.db, job.id)! };
}

function directorCalls(runId: number) {
  return listRunLlmCalls(t.db, runId).filter((c) => c.role === 'director');
}

function promptOf(promptPath: string) {
  return readDataJson(t.dataDir, promptPath) as { messages: { role: string; content: string }[] };
}

function logs(runId: number) {
  return listEventsSince(t.db, { runId, afterId: 0, limit: 500 })
    .filter((e) => e.type === 'log')
    .map((e) => e.payload as { level: string; message: string });
}

/** The good plan with `mutate` applied, as a recorded answer. */
function answer(mutate: (plan: DirectorPlan) => void): DryRunResponse {
  const plan = goodPlan();
  mutate(plan);
  return { content: JSON.stringify(plan) };
}

describe('direct job (rate-limiter fixture, dry run)', () => {
  it('writes a plan that passes every check, as the run’s gate 2 input', async () => {
    const { runId, job } = await direct(registry(director));
    expect(job.status).toBe('done');

    const result = latestDirection(t.db, t.dataDir, runId)!;
    expect(result.step).toMatchObject({ stage: 'direct', status: 'done', error: null });
    expect(result.plan).toEqual(goodPlan());
    expect(result.input).toMatchObject({
      topic: { title: RATE_LIMITER_TOPIC.title, notes: RATE_LIMITER_TOPIC.notes },
      series: { tag: 'system-design', nextNumber: 1 },
      length: { minSec: 45, maxSec: 150, reasonAboveSec: 90 },
      parts: { allowed: true, max: 4 },
      explanationLevel: 'beginner',
      memory: { styleRules: [], pastTopics: [] },
    });
    expect(result.input.length.overrideSec).toBeUndefined();
    expect(getRunStep(t.db, result.input.researchStepId)).toMatchObject({ stage: 'research' });

    const calls = directorCalls(runId);
    expect(calls).toHaveLength(director.length);
    expect(calls.at(-1)).toMatchObject({
      error: null,
      model: settings.llm.models.director,
      stepId: result.step.id,
      promptVersion: promptId('director'),
    });
    const [system, user] = promptOf(calls[0]!.promptPath).messages;
    expect(system!.content).toContain('Role: Director.');
    expect(system!.content).toContain('## OUTPUT SHAPE');
    expect(system!.content).toContain('"runningExample"');
    // The title hint is measured for this run's series label ("SYSTEM DESIGN · ").
    expect(result.input.titleMaxChars).toBe(44);
    expect(user!.content).toContain('"title": "At most about 44 characters');
    // Summaries-only catalogue: pattern ids and anchors, no params schemas.
    expect(system!.content).toContain('## PATTERNS (exhaustive');
    expect(system!.content).not.toContain('"params":');
    expect(system!.content).not.toContain('## STYLE RULES');
    // Every research number reaches the Director, by id.
    expect(user!.content).toContain(`"id": "${result.plan.story.beats[0]!.hookNumberIds![0]}"`);
    expect(user!.content).not.toContain('sourceChunkId');
    expect(user!.content).toContain('Decide within 45-150 s');

    expect(logs(runId).map((l) => l.message)).toEqual(
      expect.arrayContaining(summarize(goodPlan())),
    );
  });

  it('repairs failed checks through the LLM client', async () => {
    const bad = answer((plan) => {
      delete plan.story.beats[0]!.hookNumberIds;
      plan.story.beats[1]!.factIds.push('num-99');
      plan.story.beats[2]!.newTerms = ['leaky bucket'];
      plan.story.beats[3]!.suggestedPatternIds = ['token_drip'];
      plan.story.beats[4]!.layoutMode = 'map';
    });
    const { runId, job } = await direct(registry([bad, goodAnswer]));
    expect(job.status).toBe('done');

    const calls = directorCalls(runId);
    expect(calls.map((c) => c.error)).toEqual(['Invalid output: 5 issue(s)', null]);
    const repair = promptOf(calls[1]!.promptPath).messages.at(-1)!.content;
    for (const expected of [
      `$.story.beats[1].factIds[${goodPlan().story.beats[1]!.factIds.length}]`,
      '$.story.beats[2].newTerms[0]',
      '$.story.beats[0].hookNumberIds',
      '$.story.beats[3].suggestedPatternIds[0]',
      '$.story.beats[4].layoutMode',
    ]) {
      expect(repair).toContain(expected);
    }
  });

  it('checks HUD text: a title that would be cut off is repaired', async () => {
    const long = answer((plan) => {
      plan.meta.title =
        'Rate limiters explained from token buckets to shared stores and the incident that broke checkout';
    });
    const { runId } = await direct(registry([long, goodAnswer]));
    const repair = promptOf(directorCalls(runId)[1]!.promptPath).messages.at(-1)!.content;
    expect(repair).toContain('$.meta.title');
  });

  it('checks HUD text even when the spec has other errors, so one repair covers both', async () => {
    const both = answer((plan) => {
      plan.meta.title =
        'Rate limiters explained from token buckets to shared stores and the incident that broke checkout';
      plan.story.heroMetric = {
        label: 'Contract',
        value: '300 rps',
        storyClock: {
          from: 'Failover',
          to: 'Fix',
          startValue: 0,
          endValue: 2820,
          keyframes: [{ beatId: 'hook', value: 0 }],
        },
      };
    });
    const { runId } = await direct(registry([both, goodAnswer]));
    const repair = promptOf(directorCalls(runId)[1]!.promptPath).messages.at(-1)!.content;
    expect(repair).toContain('$.story.heroMetric.storyClock.keyframes[0].beatId');
    expect(repair).toMatch(/\$\.meta\.title: .*\(about \d+ characters\)/);
  });

  it('fails the step and the job when the plan is still invalid after every repair', async () => {
    const bad = answer((plan) => delete plan.story.runningExample);
    const { runId, job } = await direct(registry([bad, bad, bad]));
    expect(job.status).toBe('failed');
    expect(job.error).toContain('director output is still invalid after 2 repair attempts');
    expect(latestDirection(t.db, t.dataDir, runId)).toBeUndefined();
    const step = getRunStep(t.db, directorCalls(runId)[0]!.stepId!)!;
    expect(step).toMatchObject({ stage: 'direct', status: 'failed' });
    expect(step.inputPath).not.toBeNull();
  });

  it('needs finished research', async () => {
    const reg = registry(director);
    const { runId } = seedRunWithUploads(
      t.db,
      t.dataDir,
      RATE_LIMITER_TOPIC,
      RATE_LIMITER_SOURCE_FILES,
    );
    const job = enqueueJob(t.db, { type: DIRECT_JOB_TYPE, runId });
    await runNext(reg); // ingest
    await runNext(reg);
    expect(getJob(t.db, job.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('no finished research') as string,
    });
    expect(directorCalls(runId)).toEqual([]);
  });

  it('applies the run’s length and format, and the memory context', async () => {
    const [series] = listSeries(t.db);
    const past = createRun(t.db, {
      topicId: createTopic(t.db, { title: '<past-topic>' }).id,
      seriesId: series!.id,
    });
    recordExport(t.db, {
      runId: past.id,
      mp4Path: 'x.mp4',
      srtPath: 'x.srt',
      durationMs: 1,
      title: null,
    });
    // The plan's first two device/layout combos were used by the last video.
    const plan = goodPlan();
    const recent = [...new Set(plan.story.beats.flatMap((b) => deviceLayoutCombo(b) ?? []))];
    expect(recent.length).toBeGreaterThanOrEqual(2);
    t.db
      .insert(usageHistory)
      .values(
        recent
          .slice(0, 2)
          .map((value) => ({ runId: past.id, kind: 'device_layout' as const, value })),
      )
      .run();
    t.db
      .insert(memoryRules)
      .values({ scope: 'director', text: '<example-rule>', status: 'active' })
      .run();

    // The good plan reuses both: one repair moves those beats to another layout, then it passes.
    const reused = new Set(recent.slice(0, 2));
    // Each reused beat moves to a mode of its topic class that no scene uses yet, so the fix
    // also keeps the per-video layout variety rules.
    const fixed = answer((p) => {
      const allowed = TOPIC_CLASS_CATALOGUE.entries.find((c) => c.id === p.meta.topicClass)!;
      const used = new Set(p.story.beats.flatMap((b) => (b.layoutMode ? [b.layoutMode] : [])));
      const spare = allowed.allowedLayoutModes.filter((m) => !used.has(m));
      for (const beat of p.story.beats) {
        const combo = deviceLayoutCombo(beat);
        if (combo && reused.has(combo)) beat.layoutMode = spare.shift()!;
      }
    });
    const length = plan.meta.targetLengthSec!;
    const { runId, job } = await direct(registry([goodAnswer, fixed]), {
      lengthOverrideSec: length,
      format: 'card',
    });
    expect(job.status).toBe('done');

    const { input } = latestDirection(t.db, t.dataDir, runId)!;
    expect(input).toMatchObject({
      length: { overrideSec: length },
      formatOverride: 'card',
      series: { nextNumber: 2 },
    });
    const calls = directorCalls(runId);
    const [system, user] = promptOf(calls[0]!.promptPath).messages;
    expect(system!.content).toContain(
      '## STYLE RULES (from your reviews; follow them)\n- <example-rule>',
    );
    expect(user!.content).toContain(`Fixed by this run: exactly ${length} s`);
    expect(user!.content).toContain('Fixed by this run: \\"card\\"');
    expect(user!.content).toContain(`"${recent[1]}"`);
    expect(user!.content).toContain('<past-topic>');
    const repair = promptOf(calls[1]!.promptPath).messages.at(-1)!.content;
    expect(repair).toContain('recently used device/layout');
  });
});
