import { isRetryableStatus, MAX_HTTP_RETRIES, retryDelayMs } from '../http/retry.ts';
import { sleep as abortableSleep } from '../sleep.ts';
import { httpFailure, SourceIngestError } from './errors.ts';
import type { SourceRequest } from './github.ts';

/** Per attempt, from the request to the last byte of the body. */
export const FETCH_TIMEOUT_MS = 20_000;
/** Largest body read (PDFs are the big ones). Checked on Content-Length and while streaming. */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

const USER_AGENT = 'ExplainerStudio/0.1 (single-user source ingestion; fetches only given URLs)';
const ACCEPT =
  'text/html,application/xhtml+xml,text/markdown,text/plain;q=0.9,application/pdf;q=0.9,*/*;q=0.5';

export interface FetchDeps {
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export interface FetchedBody {
  readonly bytes: Uint8Array;
  /** The `Content-Type` header, null when absent. */
  readonly contentType: string | null;
  /** After redirects. */
  readonly url: string;
}

/** Internal: one attempt ran out of time (retried like 429/5xx). */
class AttemptTimeout extends Error {}

/**
 * GETs one URL (redirects followed, nothing else crawled). Retries timeouts, 429 and 5xx up to
 * `MAX_HTTP_RETRIES` times with backoff, honouring Retry-After. Every other failure, and the last
 * retryable one, is a `SourceIngestError`. An abort of `signal` rethrows its reason.
 */
export async function fetchSource(
  request: SourceRequest,
  signal: AbortSignal,
  deps: FetchDeps = {},
): Promise<FetchedBody> {
  const sleep = deps.sleep ?? abortableSleep;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  for (let retry = 0; ; retry++) {
    const attempts = retry + 1;
    const outcome = await attempt(request, signal, deps, timeoutMs).catch((error: unknown) => {
      if (error instanceof AttemptTimeout) return error;
      throw error;
    });
    const canRetry = retry < MAX_HTTP_RETRIES;
    if (outcome instanceof AttemptTimeout) {
      if (!canRetry) throw timeoutFailure(timeoutMs, attempts);
      await sleep(retryDelayMs(null, retry, now()) ?? 0, signal);
      continue;
    }
    if (!(outcome instanceof Response)) return outcome;
    const failure = httpFailure({
      status: outcome.status,
      attempts,
      rateLimitRemaining: outcome.headers.get('x-ratelimit-remaining'),
    });
    if (!isRetryableStatus(outcome.status) || !canRetry) throw failure;
    const delay = retryDelayMs(outcome.headers.get('retry-after'), retry, now());
    if (delay === null) {
      throw new SourceIngestError(failure.code, `${failure.message} (it asked to wait too long)`);
    }
    await sleep(delay, signal);
  }
}

/** The body, or the failed `Response` (its body already released) for the caller to classify. */
async function attempt(
  request: SourceRequest,
  signal: AbortSignal,
  deps: FetchDeps,
  timeoutMs: number,
): Promise<FetchedBody | Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const both = AbortSignal.any([signal, timeout]);
  const rethrow = (error: unknown): never => {
    if (signal.aborted) throw signal.reason;
    if (timeout.aborted) throw new AttemptTimeout();
    throw error;
  };
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(request.url, {
      headers: { 'user-agent': USER_AGENT, accept: ACCEPT, ...request.headers },
      redirect: 'follow',
      signal: both,
    });
  } catch (error) {
    return rethrow(networkFailure(error));
  }
  if (!response.ok) {
    release(response.body);
    return response;
  }
  const maxBytes = deps.maxBytes ?? MAX_SOURCE_BYTES;
  const bytes = await readCapped(response, maxBytes).catch(rethrow);
  return {
    bytes,
    contentType: response.headers.get('content-type'),
    url: response.url || request.url,
  };
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    release(response.body);
    throw tooLarge(maxBytes);
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => undefined);
      throw tooLarge(maxBytes);
    }
    parts.push(value);
  }
  return concat(parts, total);
}

/** Drops a body we will not read. Not awaited: a cancel can settle late (e.g. a teed stream). */
function release(stream: ReadableStream<Uint8Array> | null): void {
  void stream?.cancel().catch(() => undefined);
}

function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function tooLarge(maxBytes: number): SourceIngestError {
  const mb = Math.round(maxBytes / (1024 * 1024));
  return new SourceIngestError(
    'too_large',
    `The response is larger than ${mb} MB. Upload a smaller extract instead.`,
  );
}

function timeoutFailure(timeoutMs: number, attempts: number): SourceIngestError {
  return new SourceIngestError(
    'timeout',
    `No complete response within ${timeoutMs / 1000} s (${attempts} attempts). Retry later, or ` +
      'upload the page as a file instead.',
  );
}

function networkFailure(error: unknown): SourceIngestError {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } }).cause;
  const detail =
    typeof cause?.code === 'string'
      ? cause.code
      : typeof cause?.message === 'string'
        ? cause.message
        : (error as Error).message;
  return new SourceIngestError(
    'network',
    `Could not connect (${detail}). Check the URL, or upload the page as a file instead.`,
    { cause: error },
  );
}
