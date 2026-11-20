import { z } from 'zod';
import { sleep as abortableSleep } from '../sleep.ts';
import { RawUsageSchema, parseUsage } from './usage.ts';
import type { LlmTransport, TransportRequest, TransportResponse } from './types.ts';

/** 429/5xx retries per request, on top of the first attempt. Separate from repair retries. */
export const MAX_HTTP_RETRIES = 2;
/** Backoff before retry n (0-based) without a Retry-After header: 1 s, 2 s. */
export const BACKOFF_BASE_MS = 1_000;
/** A Retry-After longer than this is not waited for: the call fails instead. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** A request that failed: an HTTP error status (`status`), a network error or a bad body. */
export class LlmRequestError extends Error {
  override readonly name = 'LlmRequestError';
  constructor(
    message: string,
    readonly status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class LlmTimeoutError extends Error {
  override readonly name = 'LlmTimeoutError';
}

/** Thrown before any request when the client is not configured (e.g. no API key). */
export class LlmConfigError extends Error {
  override readonly name = 'LlmConfigError';
}

export interface HttpTransportOptions {
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly now?: () => number;
}

const ChatCompletionSchema = z.looseObject({
  model: z.string().nullish(),
  choices: z
    .array(
      z.looseObject({
        finish_reason: z.string().nullish(),
        message: z.looseObject({
          content: z.string().nullish(),
          reasoning_content: z.string().nullish(),
        }),
      }),
    )
    .min(1),
  usage: RawUsageSchema.nullish(),
});

export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * How long to wait before retry `retry` (0-based): Retry-After (seconds or an HTTP date) when
 * present, else exponential backoff. Null when the server asks for more than we wait.
 */
export function retryDelayMs(
  retryAfter: string | null,
  retry: number,
  nowMs: number,
): number | null {
  const asked = parseRetryAfter(retryAfter, nowMs);
  const delay = asked ?? BACKOFF_BASE_MS * 2 ** retry;
  return delay > MAX_RETRY_AFTER_MS ? null : delay;
}

function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null || value.trim() === '') return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1_000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

/** Never let the key into an error message (and from there into the DB or a log). */
function redact(text: string, apiKey: string): string {
  return text.split(apiKey).join('[redacted]');
}

function toResponse(body: string): TransportResponse {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new LlmRequestError(`Response body is not JSON: ${body.slice(0, 200)}`);
  }
  const parsed = ChatCompletionSchema.safeParse(json);
  if (!parsed.success) {
    throw new LlmRequestError(`Unexpected response body: ${z.prettifyError(parsed.error)}`);
  }
  const { model, choices, usage } = parsed.data;
  const choice = choices[0]!;
  return {
    content: choice.message.content ?? null,
    reasoningContent: choice.message.reasoning_content ?? null,
    servedModel: model ?? null,
    finishReason: choice.finish_reason ?? null,
    usage: parseUsage(usage),
    rawUsage: usage ?? null,
  };
}

/** An OpenAI-compatible `/chat/completions` client in JSON mode (DeepSeek by default). */
export function httpTransport(options: HttpTransportOptions): LlmTransport {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? Date.now;

  async function postOnce(request: TransportRequest, apiKey: string): Promise<Response> {
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    try {
      return await doFetch(chatCompletionsUrl(options.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          response_format: { type: 'json_object' },
          stream: false,
        }),
        signal,
      });
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      if (timeout.aborted) {
        throw new LlmTimeoutError(
          `No response from ${request.model} within ${options.timeoutMs} ms`,
        );
      }
      throw new LlmRequestError(
        redact(`Request failed: ${(error as Error).message}`, apiKey),
        null,
        {
          cause: error,
        },
      );
    }
  }

  async function readBody(response: Response, request: TransportRequest): Promise<string> {
    try {
      return await response.text();
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      throw new LlmRequestError(`Could not read the response body: ${(error as Error).message}`);
    }
  }

  return {
    async send(request) {
      const apiKey = options.apiKey;
      if (!apiKey) {
        throw new LlmConfigError(
          'No LLM API key: set DEEPSEEK_API_KEY in .env or llm.apiKey in Settings',
        );
      }
      for (let retry = 0; ; retry++) {
        const response = await postOnce(request, apiKey);
        const body = await readBody(response, request);
        if (response.ok) return toResponse(body);
        const message = redact(`HTTP ${response.status}: ${body.slice(0, 500)}`, apiKey);
        if (!isRetryableStatus(response.status) || retry >= MAX_HTTP_RETRIES) {
          throw new LlmRequestError(message, response.status);
        }
        const delay = retryDelayMs(response.headers.get('retry-after'), retry, now());
        if (delay === null)
          throw new LlmRequestError(`${message} (Retry-After too long)`, response.status);
        await sleep(delay, request.signal ?? new AbortController().signal);
      }
    },
  };
}
