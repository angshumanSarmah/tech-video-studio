import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LlmSettingsSchema, type LogLevel } from '@explainer-studio/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readDataJson } from '#core/data-files.ts';
import { listRunLlmCalls, runCostUsd } from '#core/db/repositories/llm-calls.ts';
import { createRun } from '#core/db/repositories/runs.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { series } from '#core/db/schema.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import {
  createLlmClient,
  invalidOutputError,
  LlmOutputInvalidError,
  MAX_REPAIR_ATTEMPTS,
  type CallJsonRequest,
} from './client.ts';
import { dryRunTransport } from './dry-run.ts';
import { createLlmTransport } from './index.ts';
import { completion, jsonResponse, scriptedFetch } from './testing.ts';
import type { BuiltPrompt, LlmTransport } from './types.ts';

const KEY = 'sk-live-do-not-write-me-7f3a9c';
/** Monday 02:00 UTC: inside DeepSeek's peak window. */
const PEAK = new Date('2026-11-16T02:00:00Z');

const llm = LlmSettingsSchema.parse({ apiKey: KEY });
const prompt: BuiltPrompt = {
  messages: [
    { role: 'system', content: 'static rules' },
    { role: 'user', content: 'topic: rate limiters' },
  ],
  versions: { preamble: 'preamble@v1', role: 'director@v1' },
};
const Schema = z.strictObject({ headline: z.string().max(20), targetSec: z.number().int() });

/** An extra check that runs on any JSON value, as `callJson` requires. */
function noBadHeadline(value: unknown) {
  const headline = (value as { headline?: unknown } | null)?.headline;
  return headline === 'Bad' ? [{ path: '$.headline', code: 'custom', message: 'Not allowed' }] : [];
}

let t: TestDb;
let runId: number;
let logs: { level: LogLevel; message: string }[];

beforeEach(() => {
  t = createTestDb();
  const topicId = createTopic(t.db, { title: 'Rate limiters' }).id;
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'system-design')).get()!.id;
  runId = createRun(t.db, { topicId, seriesId }).id;
  logs = [];
});

afterEach(() => t.cleanup());

function client(transport: LlmTransport) {
  return createLlmClient({ db: t.db, dataDir: t.dataDir, llm, transport, now: () => PEAK });
}

function httpClient(replies: Parameters<typeof scriptedFetch>[0]) {
  const scripted = scriptedFetch(replies);
  return { ...scripted, llm: client(createLlmTransport(llm, { fetch: scripted.fetch })) };
}

const call = (c: ReturnType<typeof client>, extra: Partial<CallJsonRequest<typeof Schema>> = {}) =>
  c.callJson({
    role: 'director',
    prompt,
    schema: Schema,
    runId,
    log: (level, message) => logs.push({ level, message }),
    ...extra,
  });

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('callJson: valid output', () => {
  it('returns the parsed value and logs one call with versions, tokens and cost', async () => {
    const { llm: c, requests } = httpClient([
      completion('{"headline":"Tokens refill","targetSec":60}'),
    ]);
    const result = await call(c);
    expect(result.value).toEqual({ headline: 'Tokens refill', targetSec: 60 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body.model).toBe('deepseek-v4-pro');

    const [row] = listRunLlmCalls(t.db, runId);
    expect(row).toMatchObject({
      role: 'director',
      promptVersion: 'director@v1',
      preambleVersion: 'preamble@v1',
      attempt: 0,
      model: 'deepseek-v4-pro',
      servedModel: 'served-model-0001',
      tokensInCached: 800,
      tokensInUncached: 200,
      tokensOut: 200,
      error: null,
      normalizerFixes: [],
    });
    // Pro at peak: 800 × 0.044 + 200 × 1.32 + 200 × 3.96, per million.
    expect(row?.costUsd).toBeCloseTo((800 * 0.044 + 200 * 1.32 + 200 * 3.96) / 1e6, 12);
    expect(result.costUsd).toBeCloseTo(row!.costUsd, 12);
    expect(runCostUsd(t.db, runId)).toBeCloseTo(row!.costUsd, 12);
  });

  it('writes the prompt and response files the row points to', async () => {
    const { llm: c } = httpClient([completion('{"headline":"a","targetSec":1}')]);
    await call(c);
    const [row] = listRunLlmCalls(t.db, runId);
    expect(row?.promptPath).toMatch(
      new RegExp(`^runs/${runId}/llm/.+-director-a0-[0-9a-f]{6}\\.prompt\\.json$`),
    );
    expect(readDataJson(t.dataDir, row!.promptPath)).toEqual({
      role: 'director',
      model: 'deepseek-v4-pro',
      attempt: 0,
      versions: prompt.versions,
      messages: prompt.messages,
    });
    expect(readDataJson(t.dataDir, row!.responsePath!)).toMatchObject({
      content: '{"headline":"a","targetSec":1}',
      reasoningContent: null,
      finishReason: 'stop',
      usage: { prompt_cache_hit_tokens: 800 },
    });
  });

  it('keeps calls outside a run under llm/', async () => {
    const { llm: c } = httpClient([completion('{"headline":"a","targetSec":1}')]);
    const result = await call(c, { runId: null });
    expect(listRunLlmCalls(t.db, runId)).toEqual([]);
    expect(result.callIds).toHaveLength(1);
    expect(filesUnder(join(t.dataDir, 'llm'))).toHaveLength(2);
  });

  it('normalizes before validating, and records and logs every fix', async () => {
    const { llm: c } = httpClient([
      completion('Here you go:\n```json\n{"title":"Tokens refill","targetSec":"60"}\n```'),
    ]);
    const result = await call(c, { aliases: [{ at: '$', from: 'title', to: 'headline' }] });
    expect(result.value).toEqual({ headline: 'Tokens refill', targetSec: 60 });
    const kinds = ['strip_fences', 'strip_prose', 'alias', 'numeric_string'];
    expect(result.fixes.map((f) => f.kind)).toEqual(kinds);
    expect(listRunLlmCalls(t.db, runId)[0]?.normalizerFixes.map((f) => f.kind)).toEqual(kinds);
    expect(logs.filter((l) => l.level === 'info')).toHaveLength(4);
    expect(logs[3]?.message).toBe(
      'director: normalizer numeric_string at $.targetSec: Converted "60" to a number',
    );
  });
});

describe('callJson: reasoning content', () => {
  it('stores reasoning in the response file, never parses it, and bills its tokens', async () => {
    const usage = {
      prompt_tokens: 1_000,
      completion_tokens: 5_000,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 1_000,
      completion_tokens_details: { reasoning_tokens: 4_900 },
    };
    const { llm: c } = httpClient([
      completion('{"headline":"answer","targetSec":5}', {
        reasoning: 'Draft: {"headline":"from thinking","targetSec":9}',
        usage,
      }),
    ]);
    const result = await call(c);
    expect(result.value).toEqual({ headline: 'answer', targetSec: 5 });
    const [row] = listRunLlmCalls(t.db, runId);
    expect(row).toMatchObject({ tokensOut: 5_000, tokensReasoning: 4_900 });
    expect(row?.costUsd).toBeCloseTo((1_000 * 1.32 + 5_000 * 3.96) / 1e6, 12);
    expect(readDataJson(t.dataDir, row!.responsePath!)).toMatchObject({
      reasoningContent: 'Draft: {"headline":"from thinking","targetSec":9}',
    });
  });

  it('does not fall back to reasoning when the answer is empty', async () => {
    const reasoning = '{"headline":"from thinking","targetSec":9}';
    const { llm: c } = httpClient([
      completion(null, { reasoning, finishReason: 'length' }),
      completion('', { reasoning }),
      completion(null, { reasoning }),
    ]);
    const error = (await call(c).catch((e: unknown) => e)) as LlmOutputInvalidError;
    expect(error).toBeInstanceOf(LlmOutputInvalidError);
    expect(error.issues[0]?.message).toBe('No answer (finish_reason: stop)');
  });
});

describe('callJson: repair', () => {
  it('sends the validation errors back and accepts the repaired answer', async () => {
    const { llm: c, requests } = httpClient([
      completion('{"headline":"Far too long a headline for a phone","targetSec":60.5}'),
      completion('{"headline":"Short","targetSec":60}'),
    ]);
    const result = await call(c);
    expect(result.value).toEqual({ headline: 'Short', targetSec: 60 });
    expect(result.callIds).toHaveLength(2);

    const repair = requests[1]!.body.messages;
    expect(repair.slice(0, 2)).toEqual(prompt.messages);
    expect(repair[2]).toEqual({
      role: 'assistant',
      content: '{"headline":"Far too long a headline for a phone","targetSec":60.5}',
    });
    expect(repair[3]?.role).toBe('user');
    expect(repair[3]?.content).toContain('- $.headline: Too big');
    expect(repair[3]?.content).toContain('- $.targetSec:');

    const rows = listRunLlmCalls(t.db, runId);
    expect(rows.map((r) => [r.attempt, r.error])).toEqual([
      [0, expect.stringMatching(/^Invalid output: 2 issue\(s\) \[.+\]$/)],
      [1, null],
    ]);
    expect(result.costUsd).toBeCloseTo(rows[0]!.costUsd + rows[1]!.costUsd, 12);
    expect(logs.some((l) => l.level === 'warn' && l.message.includes('repair 1/2'))).toBe(true);
  });

  it('repairs unparseable output too', async () => {
    const { llm: c, requests } = httpClient([
      completion('I think the headline should be short.'),
      completion('{"headline":"Short","targetSec":60}'),
    ]);
    await expect(call(c)).resolves.toMatchObject({ value: { headline: 'Short' } });
    expect(requests[1]?.body.messages[3]?.content).toContain('- $: No JSON object found');
  });

  it('repairs issues from the extra check, after the schema passes', async () => {
    const { llm: c } = httpClient([
      completion('{"headline":"Bad","targetSec":60}'),
      completion('{"headline":"Good","targetSec":60}'),
    ]);
    await expect(call(c, { check: noBadHeadline })).resolves.toMatchObject({
      value: { headline: 'Good' },
    });
  });

  it('runs the extra check on JSON that fails the schema, in one repair message', async () => {
    const { llm: c, requests } = httpClient([
      completion('{"headline":"Bad","targetSec":"soon"}'),
      completion('{"headline":"Good","targetSec":60}'),
    ]);
    await expect(call(c, { check: noBadHeadline })).resolves.toMatchObject({
      value: { headline: 'Good' },
    });
    const repair = requests[1]?.body.messages[3]?.content;
    expect(repair).toContain('- $.targetSec:');
    expect(repair).toContain('- $.headline: Not allowed');
    expect(listRunLlmCalls(t.db, runId)[0]?.error).toMatch(/^Invalid output: 2 issue\(s\) \[/);
  });

  it('accepts an answer whose only issues are soft (advisory)', async () => {
    const soft = () => [{ path: '$.headline', code: 'unknown_asset', message: 'Odd', soft: true }];
    const { llm: c, requests } = httpClient([completion('{"headline":"Fine","targetSec":60}')]);
    await expect(call(c, { check: soft })).resolves.toMatchObject({ value: { headline: 'Fine' } });
    expect(requests).toHaveLength(1);
  });

  it('lists soft issues as advisory when another issue forces a repair', async () => {
    const both = (value: unknown) => [
      ...noBadHeadline(value),
      { path: '$.targetSec', code: 'unknown_asset', message: 'Odd', soft: true },
    ];
    const { llm: c, requests } = httpClient([
      completion('{"headline":"Bad","targetSec":60}'),
      completion('{"headline":"Good","targetSec":60}'),
    ]);
    await expect(call(c, { check: both })).resolves.toMatchObject({ value: { headline: 'Good' } });
    const repair = requests[1]?.body.messages[3]?.content;
    expect(repair).toContain('- $.headline: Not allowed');
    expect(repair).toContain('- $.targetSec: (advisory) Odd');
  });

  it('repairs the schema issues alone when the check throws on an invalid shape', async () => {
    const { llm: c, requests } = httpClient([
      completion('[1, 2]'),
      completion('{"headline":"Good","targetSec":60}'),
    ]);
    const check = (v: unknown) => {
      if (Array.isArray(v)) throw new Error('not an object');
      return [];
    };
    await expect(call(c, { check })).resolves.toMatchObject({ value: { headline: 'Good' } });
    expect(requests[1]?.body.messages[3]?.content).toContain('- $: ');
  });

  it(`throws after ${MAX_REPAIR_ATTEMPTS} failed repairs, with every attempt logged`, async () => {
    const bad = () => completion('{"headline":1,"targetSec":60}');
    const { llm: c, requests } = httpClient([bad(), bad(), bad()]);
    const error = (await call(c).catch((e: unknown) => e)) as LlmOutputInvalidError;
    expect(error).toBeInstanceOf(LlmOutputInvalidError);
    expect(error.issues).toEqual([
      expect.objectContaining({ path: '$.headline', code: 'invalid_type' }),
    ]);
    expect(error.callIds).toHaveLength(3);
    expect(requests).toHaveLength(3);
    expect(requests[2]?.body.messages).toHaveLength(6);
    expect(listRunLlmCalls(t.db, runId).map((r) => r.attempt)).toEqual([0, 1, 2]);
  });

  it('keeps HTTP retries separate from repair attempts', async () => {
    const { llm: c, requests } = httpClient([
      jsonResponse({ error: 'busy' }, 429, { 'retry-after': '0' }),
      completion('{"headline":1,"targetSec":60}'),
      completion('{"headline":"ok","targetSec":60}'),
    ]);
    await expect(call(c)).resolves.toMatchObject({ value: { headline: 'ok' } });
    expect(requests).toHaveLength(3);
    expect(listRunLlmCalls(t.db, runId).map((r) => r.attempt)).toEqual([0, 1]);
  });
});

describe('callJson: failures and secrets', () => {
  it('logs a failed request with its error and no response, then rethrows', async () => {
    const { llm: c } = httpClient([jsonResponse({ error: 'bad request' }, 400)]);
    await expect(call(c)).rejects.toThrow(/HTTP 400/);
    const [row] = listRunLlmCalls(t.db, runId);
    expect(row).toMatchObject({ responsePath: null, costUsd: 0 });
    expect(row?.error).toContain('HTTP 400');
  });

  it('never writes the API key to any file or row', async () => {
    const { llm: c, requests } = httpClient([
      completion('{"headline":1,"targetSec":60}', { reasoning: 'thinking' }),
      completion('{"headline":"ok","targetSec":60}'),
      jsonResponse({ error: `invalid key ${KEY}` }, 401),
    ]);
    await call(c);
    await expect(call(c)).rejects.toThrow(/HTTP 401/);
    expect((requests[0]?.init.headers as Record<string, string>).authorization).toContain(KEY);

    // Two answered calls (prompt + response) and a failed one (prompt only).
    expect(filesUnder(join(t.dataDir, 'runs'))).toHaveLength(5);
    // Every file in the data dir, the SQLite file and its WAL included.
    for (const file of filesUnder(t.dataDir)) {
      expect(readFileSync(file).includes(KEY), file).toBe(false);
    }
    for (const row of listRunLlmCalls(t.db, runId)) expect(JSON.stringify(row)).not.toContain(KEY);
  });
});

describe('callJson: concurrency and replay keys', () => {
  /** A transport that answers only when told to, recording when each request arrives. */
  function heldTransport() {
    const arrived: string[] = [];
    const release = new Map<string, () => void>();
    let inFlight = 0;
    let peak = 0;
    const transport: LlmTransport = {
      async send(req) {
        const key = req.replayKey ?? '?';
        arrived.push(key);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => release.set(key, resolve));
        inFlight -= 1;
        return {
          content: '{"headline":"ok","targetSec":60}',
          reasoningContent: null,
          servedModel: 'held',
          finishReason: 'stop',
          usage: { inCached: 0, inUncached: 1, out: 1, reasoning: 0 },
          rawUsage: null,
        };
      },
    };
    return { transport, arrived, release, peak: () => peak };
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('keeps at most maxConcurrent requests in flight, across roles, in arrival order', async () => {
    const held = heldTransport();
    const c = createLlmClient({
      db: t.db,
      dataDir: t.dataDir,
      llm: { ...llm, maxConcurrent: 2 },
      transport: held.transport,
      now: () => PEAK,
    });
    const calls = (['a', 'b', 'c', 'd'] as const).map((key, i) =>
      call(c, { role: i % 2 === 0 ? 'generator' : 'director', replayKey: key }),
    );
    await tick();
    expect(held.arrived).toEqual(['a', 'b']);
    held.release.get('b')?.();
    await tick();
    expect(held.arrived).toEqual(['a', 'b', 'c']);
    held.release.get('a')?.();
    held.release.get('c')?.();
    await tick();
    held.release.get('d')?.();
    await Promise.all(calls);
    expect(held.arrived).toEqual(['a', 'b', 'c', 'd']);
    expect(held.peak()).toBe(2);
  });

  it('passes the replay key to the transport and writes it to the prompt file', async () => {
    const c = client(
      dryRunTransport({ generator: { 'beat-2': [{ content: '{"headline":"x","targetSec":1}' }] } }),
    );
    await expect(call(c, { role: 'generator', replayKey: 'beat-2' })).resolves.toMatchObject({
      value: { headline: 'x' },
    });
    const [row] = listRunLlmCalls(t.db, runId);
    expect(readDataJson(t.dataDir, row!.promptPath)).toMatchObject({ replayKey: 'beat-2' });
  });
});

describe('callJson: dry run', () => {
  it('replays recorded responses through the same validation, logging and cost', async () => {
    const c = client(
      dryRunTransport({
        director: [
          {
            content: '{"headline":"x","targetSec":"60"}',
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          },
        ],
      }),
    );
    const result = await call(c);
    expect(result.value).toEqual({ headline: 'x', targetSec: 60 });
    expect(listRunLlmCalls(t.db, runId)[0]).toMatchObject({
      servedModel: 'dry-run',
      tokensInUncached: 10,
      tokensOut: 5,
    });
    await expect(call(c)).rejects.toThrow(/No recorded director response left/);
  });
});

describe('invalidOutputError', () => {
  it('lists each code once, soft ones marked', () => {
    expect(
      invalidOutputError([
        { path: '$.a', message: 'x', code: 'focus_missing' },
        { path: '$.b', message: 'y', code: 'focus_missing' },
        { path: '$.c', message: 'z', code: 'unknown_asset', soft: true },
        { path: '$.d', message: 'w' },
      ]),
    ).toBe('Invalid output: 4 issue(s) [focus_missing, ~unknown_asset, invalid]');
  });
});
