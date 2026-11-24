import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { series } from '../schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../testing.ts';
import { insertLlmCall, listRunLlmCalls, runCostUsd, type NewLlmCall } from './llm-calls.ts';
import { createRun } from './runs.ts';
import { createTopic } from './topics.ts';

let t: TestDb;
let runId: number;

beforeEach(() => {
  t = createTestDb();
  const topicId = createTopic(t.db, { title: 'Rate limiters' }).id;
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'system-design')).get()!.id;
  runId = createRun(t.db, { app: TEST_APP_SETTINGS, topicId, seriesId }).id;
});

afterEach(() => t.cleanup());

const call = (forRun: number | null, costUsd: number): NewLlmCall => ({
  runId: forRun,
  role: 'director',
  promptVersion: 'director@v1',
  preambleVersion: 'preamble@v1',
  attempt: 0,
  model: 'model',
  servedModel: null,
  tokensInCached: 10,
  tokensInUncached: 20,
  tokensOut: 30,
  tokensReasoning: 5,
  costUsd,
  promptPath: 'prompt.json',
  responsePath: 'response.json',
  durationMs: 12,
  error: null,
  normalizerFixes: [{ kind: 'strip_fences', message: 'Removed a code fence' }],
});

describe('insertLlmCall', () => {
  it('stores versions, attempt, reasoning tokens and normalizer fixes', () => {
    const row = insertLlmCall(t.db, call(runId, 0.1));
    expect(listRunLlmCalls(t.db, runId)).toEqual([row]);
    expect(row).toMatchObject({
      preambleVersion: 'preamble@v1',
      promptVersion: 'director@v1',
      tokensReasoning: 5,
      normalizerFixes: [{ kind: 'strip_fences', message: 'Removed a code fence' }],
    });
  });
});

describe('runCostUsd', () => {
  it("sums the run's LLM calls only (0 without any)", () => {
    expect(runCostUsd(t.db, runId)).toBe(0);
    insertLlmCall(t.db, call(runId, 0.25));
    insertLlmCall(t.db, call(runId, 0.5));
    insertLlmCall(t.db, call(null, 3));
    expect(runCostUsd(t.db, runId)).toBeCloseTo(0.75);
  });
});
