import { describe, expect, it, vi } from 'vitest';
import { MAX_RETRY_AFTER_MS } from '../http/retry.ts';
import {
  completion,
  completionBody,
  hangUntilAborted,
  jsonResponse,
  scriptedFetch,
} from './testing.ts';
import {
  chatCompletionsUrl,
  httpTransport,
  LlmConfigError,
  LlmRequestError,
  LlmTimeoutError,
} from './transport.ts';
import type { TransportRequest } from './types.ts';

const KEY = 'sk-test-0123456789-secret';
const request: TransportRequest = {
  role: 'director',
  model: 'deepseek-v4-pro',
  messages: [
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'input' },
  ],
};

function transport(
  fetch: typeof globalThis.fetch,
  overrides: { timeoutMs?: number; apiKey?: string } = {},
) {
  const sleeps: number[] = [];
  const t = httpTransport({
    baseUrl: 'https://llm.example.test/',
    apiKey: 'apiKey' in overrides ? overrides.apiKey : KEY,
    timeoutMs: overrides.timeoutMs ?? 5_000,
    fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => Date.parse('2026-11-20T10:00:00Z'),
  });
  return { t, sleeps };
}

describe('httpTransport request', () => {
  it('posts the messages in JSON mode with the key in the header only', async () => {
    const { fetch, requests } = scriptedFetch([completion('{"ok":true}')]);
    await transport(fetch).t.send(request);
    const [sent] = requests;
    expect(sent?.url).toBe('https://llm.example.test/chat/completions');
    expect(sent?.body).toEqual({
      model: 'deepseek-v4-pro',
      messages: request.messages,
      response_format: { type: 'json_object' },
      stream: false,
    });
    expect((sent?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(sent?.init.body as string).not.toContain(KEY);
  });

  it('joins the base URL with or without a trailing slash', () => {
    expect(chatCompletionsUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/chat/completions',
    );
    expect(chatCompletionsUrl('https://h/v1//')).toBe('https://h/v1/chat/completions');
  });

  it('fails fast without an API key, before any request', async () => {
    const { fetch, requests } = scriptedFetch([]);
    await expect(transport(fetch, { apiKey: undefined }).t.send(request)).rejects.toBeInstanceOf(
      LlmConfigError,
    );
    expect(requests).toHaveLength(0);
  });
});

describe('httpTransport response', () => {
  it('returns content, reasoning content apart from it, served model and usage', async () => {
    const usage = {
      prompt_tokens: 1_000,
      completion_tokens: 600,
      prompt_cache_hit_tokens: 900,
      prompt_cache_miss_tokens: 100,
      completion_tokens_details: { reasoning_tokens: 450 },
    };
    const { fetch } = scriptedFetch([
      jsonResponse(completionBody({ content: '{"a":1}', reasoning: 'think {"a":2}', usage })),
    ]);
    expect(await transport(fetch).t.send(request)).toEqual({
      content: '{"a":1}',
      reasoningContent: 'think {"a":2}',
      servedModel: 'served-model-0001',
      finishReason: 'stop',
      usage: { inCached: 900, inUncached: 100, out: 600, reasoning: 450 },
      rawUsage: usage,
    });
  });

  it('rejects a body that is not a chat completion', async () => {
    const { fetch } = scriptedFetch([jsonResponse({ choices: [] }), new Response('<html>')]);
    const { t } = transport(fetch);
    await expect(t.send(request)).rejects.toThrow(/Unexpected response body/);
    await expect(t.send(request)).rejects.toThrow(/not JSON/);
  });
});

describe('httpTransport retries', () => {
  it.each([429, 500, 503])('retries %s with backoff, then succeeds', async (status) => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse({ error: 'busy' }, status),
      jsonResponse({ error: 'busy' }, status),
      completion('{}'),
    ]);
    const { t, sleeps } = transport(fetch);
    await expect(t.send(request)).resolves.toMatchObject({ content: '{}' });
    expect(requests).toHaveLength(3);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it('gives up after 2 retries with the last status', async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse({}, 502),
      jsonResponse({}, 502),
      jsonResponse({ error: 'still down' }, 502),
    ]);
    const error = await transport(fetch)
      .t.send(request)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmRequestError);
    expect(error).toMatchObject({ status: 502 });
    expect((error as Error).message).toContain('still down');
    expect(requests).toHaveLength(3);
  });

  it.each([400, 401, 404, 422])('does not retry %s', async (status) => {
    const { fetch, requests } = scriptedFetch([jsonResponse({ error: 'no' }, status)]);
    await expect(transport(fetch).t.send(request)).rejects.toMatchObject({ status });
    expect(requests).toHaveLength(1);
  });

  it('honours Retry-After in seconds and as an HTTP date', async () => {
    const { fetch } = scriptedFetch([
      jsonResponse({}, 429, { 'retry-after': '7' }),
      jsonResponse({}, 503, { 'retry-after': 'Fri, 20 Nov 2026 10:00:03 GMT' }),
      completion('{}'),
    ]);
    const { t, sleeps } = transport(fetch);
    await t.send(request);
    expect(sleeps).toEqual([7_000, 3_000]);
  });

  it('fails instead of waiting for a Retry-After past the cap', async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse({}, 429, { 'retry-after': String(MAX_RETRY_AFTER_MS / 1000 + 1) }),
    ]);
    await expect(transport(fetch).t.send(request)).rejects.toThrow(/Retry-After too long/);
    expect(requests).toHaveLength(1);
  });

  it('redacts the key if a server echoes it', async () => {
    const { fetch } = scriptedFetch([jsonResponse({ error: `bad key ${KEY}` }, 401)]);
    const error = (await transport(fetch)
      .t.send(request)
      .catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain(KEY);
  });
});

describe('httpTransport timeout and abort', () => {
  it('times out a request that never answers', async () => {
    const { fetch } = scriptedFetch([hangUntilAborted]);
    await expect(transport(fetch, { timeoutMs: 20 }).t.send(request)).rejects.toBeInstanceOf(
      LlmTimeoutError,
    );
  });

  it("rejects with the caller's abort reason, not a timeout", async () => {
    const { fetch } = scriptedFetch([hangUntilAborted]);
    const controller = new AbortController();
    const sent = transport(fetch).t.send({ ...request, signal: controller.signal });
    const reason = new Error('shutdown');
    controller.abort(reason);
    await expect(sent).rejects.toBe(reason);
  });

  it('stops waiting between retries when aborted', async () => {
    const controller = new AbortController();
    const { fetch, requests } = scriptedFetch([jsonResponse({}, 503), completion('{}')]);
    const t = httpTransport({ baseUrl: 'https://h', apiKey: KEY, timeoutMs: 5_000, fetch });
    vi.useFakeTimers();
    try {
      const sent = t.send({ ...request, signal: controller.signal });
      const reason = new Error('shutdown');
      await vi.advanceTimersByTimeAsync(10);
      controller.abort(reason);
      await expect(sent).rejects.toBe(reason);
      expect(requests).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
