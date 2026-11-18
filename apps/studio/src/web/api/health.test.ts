import { describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './health.ts';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fetchHealth', () => {
  it('returns the parsed health payload', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ status: 'ok', uptimeSeconds: 3 })));
    await expect(fetchHealth(fetchFn)).resolves.toEqual({ status: 'ok', uptimeSeconds: 3 });
    expect(fetchFn).toHaveBeenCalledWith('/api/health');
  });

  it('throws on a non-2xx response', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({}, 503)));
    await expect(fetchHealth(fetchFn)).rejects.toThrow('HTTP 503');
  });

  it('throws when the payload violates the contract', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ status: 'down' })));
    await expect(fetchHealth(fetchFn)).rejects.toThrow();
  });
});
