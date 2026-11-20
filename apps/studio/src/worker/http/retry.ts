/**
 * Retry rules shared by the worker's HTTP clients (LLM transport, source fetching): retry 429 and
 * 5xx (and, where the caller chooses, timeouts) with exponential backoff, honouring Retry-After.
 */

/** Retries per request, on top of the first attempt. */
export const MAX_HTTP_RETRIES = 2;
/** Backoff before retry n (0-based) without a Retry-After header: 1 s, 2 s. */
export const BACKOFF_BASE_MS = 1_000;
/** A Retry-After longer than this is not waited for: the request fails instead. */
export const MAX_RETRY_AFTER_MS = 60_000;

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
