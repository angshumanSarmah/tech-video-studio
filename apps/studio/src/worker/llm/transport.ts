import { z } from 'zod';
import { isRetryableStatus, MAX_HTTP_RETRIES, retryDelayMs } from '../http/retry.ts';
import { sleep as abortableSleep } from '../sleep.ts';
import { RawUsageSchema, parseUsage } from './usage.ts';
import type { LlmTransport, TransportRequest, TransportResponse } from './types.ts';

/** A request that failed: an HTTP error status (`status`), a network error or a bad body. */
export class LlmRequestError extends Error {
  override readonly name: string = 'LlmRequestError';
  constructor(
    message: string,
    readonly status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * The connection dropped while the response body was streaming in (e.g. "terminated"). Retried
 * with backoff like a 5xx: the server answered, the network lost the rest.
 */
export class LlmBodyCutOffError extends LlmRequestError {
  override readonly name = 'LlmBodyCutOffError';
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

  const timedOut = (request: TransportRequest) =>
    new LlmTimeoutError(`No response from ${request.model} within ${options.timeoutMs} ms`);

  /** The response and the timeout that also covers reading its body. */
  async function postOnce(
    request: TransportRequest,
    apiKey: string,
  ): Promise<{ response: Response; timeout: AbortSignal }> {
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    try {
      const response = await doFetch(chatCompletionsUrl(options.baseUrl), {
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
      return { response, timeout };
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      if (timeout.aborted) throw timedOut(request);
      throw new LlmRequestError(
        redact(`Request failed: ${(error as Error).message}`, apiKey),
        null,
        {
          cause: error,
        },
      );
    }
  }

  async function readBody(
    response: Response,
    timeout: AbortSignal,
    request: TransportRequest,
  ): Promise<string> {
    try {
      return await response.text();
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      if (timeout.aborted) throw timedOut(request);
      throw new LlmBodyCutOffError(
        `Could not read the response body: ${(error as Error).message}`,
        response.status,
        { cause: error },
      );
    }
  }

  /** One request: the status and body, or null when the body was cut off and may be retried. */
  async function attempt(request: TransportRequest, apiKey: string, lastTry: boolean) {
    const { response, timeout } = await postOnce(request, apiKey);
    try {
      return { response, body: await readBody(response, timeout, request) };
    } catch (error) {
      if (error instanceof LlmBodyCutOffError && !lastTry) return null;
      throw error;
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
        const result = await attempt(request, apiKey, retry >= MAX_HTTP_RETRIES);
        if (result === null) {
          await sleep(
            retryDelayMs(null, retry, now())!,
            request.signal ?? new AbortController().signal,
          );
          continue;
        }
        const { response, body } = result;
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
