import type { ApiError } from '@explainer-studio/shared';
import { expect } from 'vitest';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { createApp, type App, type AppDeps } from './app.ts';

/** Test-only helpers. Not imported by any entrypoint. */

export interface TestServer extends TestDb {
  readonly app: App;
}

export function createTestServer(deps: Omit<AppDeps, 'db'> = {}): TestServer {
  const testDb = createTestDb();
  const app = createApp({ events: { pollMs: 5, heartbeatMs: 1_000 }, ...deps, db: testDb.db });
  return { ...testDb, app };
}

export function postJson(app: App, path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export async function expectApiError(
  res: Response,
  status: number,
  code: ApiError['error']['code'],
): Promise<ApiError> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as ApiError;
  expect(body.error.code).toBe(code);
  return body;
}
