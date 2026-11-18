import { HealthResponseSchema } from '@explainer-studio/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { stubFetch } from '#web/testing.ts';
import { ApiContractError, ApiRequestError, postJson, request } from './client.ts';
import { startNoopJob } from './dev.ts';
import { fetchHealth } from './health.ts';

afterEach(() => vi.unstubAllGlobals());

describe('request', () => {
  it('prefixes /api and returns the parsed body', async () => {
    const fetchMock = stubFetch({ 'GET /api/health': { status: 'ok', uptimeSeconds: 3 } });
    await expect(request('/health', HealthResponseSchema)).resolves.toEqual({
      status: 'ok',
      uptimeSeconds: 3,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/health', undefined);
  });

  it('throws ApiRequestError carrying the shared error body', async () => {
    const body = { error: { code: 'not_found', message: 'Run 9 not found' } };
    stubFetch({ 'GET /api/health': () => Response.json(body, { status: 404 }) });

    const error = await request('/health', HealthResponseSchema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 404, body, message: 'Run 9 not found' });
  });

  it('falls back to the HTTP status when the error body is not an ApiError', async () => {
    stubFetch({ 'GET /api/health': () => new Response('gateway down', { status: 503 }) });
    await expect(request('/health', HealthResponseSchema)).rejects.toThrow('HTTP 503');
  });

  it('throws ApiContractError when a 2xx body violates the schema', async () => {
    stubFetch({ 'GET /api/health': { status: 'down' } });
    const error = await request('/health', HealthResponseSchema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiContractError);
    expect((error as Error).message).toContain('Unexpected response from /health');
  });
});

describe('postJson', () => {
  it('sends a JSON body', async () => {
    const fetchMock = stubFetch({ 'POST /api/health': { status: 'ok', uptimeSeconds: 0 } });
    await postJson('/health', HealthResponseSchema, { a: 1 });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
  });
});

describe('endpoints', () => {
  it('fetchHealth calls GET /api/health', async () => {
    stubFetch({ 'GET /api/health': { status: 'ok', uptimeSeconds: 1 } });
    await expect(fetchHealth()).resolves.toMatchObject({ status: 'ok' });
  });

  it('startNoopJob calls POST /api/dev/noop-job', async () => {
    const job = {
      id: 4,
      type: 'noop',
      runId: null,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    stubFetch({ 'POST /api/dev/noop-job': job });
    await expect(startNoopJob()).resolves.toEqual(job);
  });
});
