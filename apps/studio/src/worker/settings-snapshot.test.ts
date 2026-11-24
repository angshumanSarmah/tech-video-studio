import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  SettingsSchema,
  type ModelPrice,
  type RenderableVideoSpec,
  type SettingsInput,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSettings, settingsPathFor } from '#core/config.ts';
import { readDataJson } from '#core/data-files.ts';
import { enqueueJob } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { getLatestSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { latestResearch } from '#core/services/research-notes.ts';
import { startRun as startRunService } from '#core/services/runs.ts';
import { saveSpecVersion } from '#core/services/spec-versions.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { fixtureResponsesDir, fixtureTopic } from './agents/fixture-topics.ts';
import { fixtureScriptedSpec } from './agents/generator/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from './agents/prompts/templates.ts';
import { seedRunWithUploads } from './agents/researcher/testing.ts';
import { ingestJobHandler } from './jobs/ingest.ts';
import { createJobRegistry, type JobRegistry } from './jobs/registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from './jobs/research.ts';
import { TTS_JOB_TYPE, ttsJobHandler } from './jobs/tts.ts';
import { createLlmClient } from './llm/client.ts';
import { callCostUsd } from './llm/cost.ts';
import { dryRunTransport, recordedInOrder } from './llm/dry-run.ts';
import { uniformTts } from './repair/testing.ts';
import { runNextJob } from './runner.ts';
import type { TtsProvider } from './tts/provider.ts';

/**
 * P1C.9 step 1: a run resolves its settings once, when it starts. A run started under settings A
 * keeps A's prompt variables, research budget, model, prices, voice, speed and pauses after
 * settings.json is changed to B, even in a worker built from B; a run started after the edit
 * gets B.
 */

const prompts = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));
const NOW = new Date('2026-11-25T10:00:00Z');

const tenTimes = (price: ModelPrice): ModelPrice => ({
  ...price,
  inputCacheHitPerMTok: price.inputCacheHitPerMTok * 10,
  inputCacheMissPerMTok: price.inputCacheMissPerMTok * 10,
  outputPerMTok: price.outputPerMTok * 10,
});

const A: SettingsInput = {};
const B: SettingsInput = (() => {
  const prices = SettingsSchema.parse({}).llm.prices;
  return {
    video: { explanationLevel: 'expert' },
    research: { sourceTokenBudget: 50_000 },
    llm: {
      models: { researcher: 'deepseek-v4-pro' },
      prices: Object.fromEntries(Object.entries(prices).map(([m, p]) => [m, tenTimes(p)])),
    },
    tts: { voice: 'bf_emma', speed: 1.2 },
    timing: { beatGapSec: 0.5 },
  };
})();

let t: TestDb;
let settingsPath: string;

beforeEach(() => {
  t = createTestDb();
  settingsPath = settingsPathFor(t.dataDir);
  mkdirSync(dirname(settingsPath), { recursive: true });
});

afterEach(() => t.cleanup());

const writeSettings = (input: SettingsInput) =>
  writeFileSync(settingsPath, JSON.stringify(input, null, 2));

/**
 * A run of the rate limiter, its snapshot taken from settings.json as it is now. Later runs are on
 * the first run's topic, so they read the same sources (the recorded answer cites their chunks).
 */
function startRun(): number {
  const app = readSettings(settingsPath);
  const first = getRun(t.db, 1);
  if (first) {
    return startRunService(t.db, { topicId: first.topicId, seriesId: first.seriesId, app }).run.id;
  }
  const { topic, sourceFiles, seriesTag } = fixtureTopic('rate-limiter');
  return seedRunWithUploads(t.db, t.dataDir, topic, sourceFiles, { seriesTag, app }).runId;
}

/** TTS calls with the voice and speed each was asked for. */
function recordingTts(): { provider: TtsProvider; asked: { voice: string; speed: number }[] } {
  const inner = uniformTts(join(t.dataDir, 'fake-tts')).provider;
  const asked: { voice: string; speed: number }[] = [];
  return {
    asked,
    provider: {
      synthesize: (text, voice, speed, options) => {
        asked.push({ voice, speed });
        return inner.synthesize(text, voice, speed, options);
      },
      close: () => inner.close(),
    },
  };
}

/** The worker as it would start now: its own LLM settings read from settings.json. */
function workerFromCurrentSettings(tts: TtsProvider): JobRegistry {
  const answer = recordedInOrder(
    fixtureResponsesDir('researcher', 'rate-limiter'),
    'researcher',
  ).at(-1)!;
  const llm = createLlmClient({
    db: t.db,
    dataDir: t.dataDir,
    llm: readSettings(settingsPath).llm,
    transport: dryRunTransport({ researcher: [answer, answer] }),
    now: () => NOW,
  });
  const deps = { db: t.db, dataDir: t.dataDir, llm, prompts, tts };
  return createJobRegistry([ingestJobHandler(deps), researchJobHandler(deps), ttsJobHandler(deps)]);
}

async function drain(registry: JobRegistry): Promise<void> {
  const signal = new AbortController().signal;
  while (await runNextJob({ db: t.db, registry, workerId: 't', signal })) {
    /* until the queue is empty */
  }
}

/** Research, then TTS on the scripted fixture spec saved as the run's first version. */
async function researchAndNarrate(registry: JobRegistry, runIds: readonly number[]) {
  for (const runId of runIds) enqueueJob(t.db, { type: RESEARCH_JOB_TYPE, runId });
  await drain(registry);
  for (const runId of runIds) {
    const spec = fixtureScriptedSpec('rate-limiter');
    const saved = saveSpecVersion(t.db, t.dataDir, { runId, spec, createdBy: 'agent' });
    const payload = { specVersionId: saved.version.id };
    enqueueJob(t.db, { type: TTS_JOB_TYPE, runId, payload });
  }
  await drain(registry);
}

function observed(runId: number) {
  const call = listRunLlmCalls(t.db, runId).find((c) => c.role === 'researcher')!;
  const system = (readDataJson(t.dataDir, call.promptPath) as { messages: { content: string }[] })
    .messages[0]!.content;
  const version = getLatestSpecVersion(t.db, runId)!;
  const spec = readDataJson(t.dataDir, version.jsonPath) as RenderableVideoSpec;
  return {
    level: /explanation level: (\w+)/.exec(system)?.[1],
    budget: latestResearch(t.db, t.dataDir, runId)!.input.budget.tokens,
    model: call.model,
    costUsd: call.costUsd,
    usage: {
      inCached: call.tokensInCached,
      inUncached: call.tokensInUncached,
      out: call.tokensOut,
    },
    pauses: spec.timing?.pauses,
  };
}

describe('the settings snapshot', () => {
  it("keeps a running run's prompts, budget, model, prices, voice and pauses after an edit", async () => {
    writeSettings(A);
    const before = startRun();
    writeSettings(B);
    const after = startRun();
    const tts = recordingTts();
    await researchAndNarrate(workerFromCurrentSettings(tts.provider), [before, after]);

    const a = SettingsSchema.parse(A);
    const old = observed(before);
    expect(old).toMatchObject({
      level: 'beginner',
      budget: 60_000,
      model: 'deepseek-flash',
      pauses: { beatGapSec: 0 },
    });
    const usage = { ...old.usage, reasoning: 0 };
    expect(old.costUsd).toBeCloseTo(callCostUsd(usage, a.llm.prices['deepseek-flash']!, NOW), 12);
    expect(observed(after)).toMatchObject({
      level: 'expert',
      budget: 50_000,
      model: 'deepseek-v4-pro',
      pauses: { beatGapSec: 0.5 },
    });

    const beats = fixtureScriptedSpec('rate-limiter').story.beats.length;
    expect(tts.asked.slice(0, beats).every((c) => c.voice === 'af_heart' && c.speed === 1)).toBe(
      true,
    );
    expect(tts.asked.slice(beats).every((c) => c.voice === 'bf_emma' && c.speed === 1.2)).toBe(
      true,
    );
  });

  it('is stored on the run, with the run overrides applied over the app settings', () => {
    writeSettings({ video: { wordsPerSec: 2.4 }, budget: { maxRunUsd: 1.5 } });
    const runId = startRun();
    writeSettings({});
    const snapshot = getRun(t.db, runId)!.resolvedSettings;
    expect(snapshot.video.wordsPerSec).toBe(2.4);
    expect(snapshot.budget.maxRunUsd).toBe(1.5);
    expect(snapshot).not.toHaveProperty('llm.apiKey');
  });
});
