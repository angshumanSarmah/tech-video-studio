import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HealthResponseSchema } from '@explainer-studio/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestServer, expectApiError, postJson, type TestServer } from './testing.ts';

let s: TestServer | undefined;

afterEach(() => {
  s?.cleanup();
  s = undefined;
});

describe('server app', () => {
  it('GET /api/health returns the shared health contract', async () => {
    s = createTestServer({ uptimeSeconds: () => 42 });
    const res = await s.app.request('/api/health');

    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(await res.json())).toEqual({
      status: 'ok',
      uptimeSeconds: 42,
    });
  });

  it('returns a JSON 404 for unknown /api routes', async () => {
    s = createTestServer();
    const body = await expectApiError(await s.app.request('/api/nope'), 404, 'not_found');
    expect(body.error.message).toBe('No route for GET /api/nope');
  });

  it('returns 400 for a malformed JSON body', async () => {
    s = createTestServer();
    const res = await s.app.request('/api/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    await expectApiError(res, 400, 'bad_request');
  });

  it('returns 500 in the shared shape for unexpected errors', async () => {
    s = createTestServer();
    s.cleanup(); // closes the DB, so the next query throws
    const res = await postJson(s.app, '/api/topics', { title: 'x' });
    const body = await expectApiError(res, 500, 'internal');
    expect(body.error.message).toBe('Internal server error');
    s = undefined;
  });
});

describe('SPA serving', () => {
  function buildDist(): string {
    const dir = mkdtempSync(join(tmpdir(), 'studio-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>studio</title>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    return dir;
  }

  it('serves files and falls back to index.html for client routes', async () => {
    s = createTestServer({ webDistDir: buildDist() });

    const asset = await s.app.request('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('console.log(1)');

    const route = await s.app.request('/runs/12');
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('<title>studio</title>');
  });

  it('never shadows unknown /api routes with the SPA', async () => {
    s = createTestServer({ webDistDir: buildDist() });
    await expectApiError(await s.app.request('/api/nope'), 404, 'not_found');
  });

  it('is not mounted without a dist dir (dev)', async () => {
    s = createTestServer();
    expect((await s.app.request('/runs/12')).status).toBe(404);
  });
});
