import { describe, expect, it } from 'vitest';
import { isRetryableStatus, MAX_RETRY_AFTER_MS, retryDelayMs } from './retry.ts';

describe('retryDelayMs', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');

  it('backs off exponentially without Retry-After', () => {
    expect(retryDelayMs(null, 0, now)).toBe(1_000);
    expect(retryDelayMs(null, 1, now)).toBe(2_000);
    expect(retryDelayMs('soon', 0, now)).toBe(1_000);
  });

  it('honours Retry-After in seconds or as an HTTP date', () => {
    expect(retryDelayMs('0', 1, now)).toBe(0);
    expect(retryDelayMs('3', 0, now)).toBe(3_000);
    expect(retryDelayMs('Fri, 20 Nov 2026 10:00:05 GMT', 0, now)).toBe(5_000);
    expect(retryDelayMs('Fri, 20 Nov 2026 09:00:00 GMT', 0, now)).toBe(0);
  });

  it('refuses a Retry-After past the cap', () => {
    expect(retryDelayMs(String(MAX_RETRY_AFTER_MS / 1000 + 1), 0, now)).toBeNull();
  });
});

describe('isRetryableStatus', () => {
  it('retries 429 and 5xx only', () => {
    expect([429, 500, 503, 400, 403, 404].map(isRetryableStatus)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
