import { describe, expect, it } from 'vitest';

// Vite serves src/web as its root, so src/web/api/x.ts is requested as /api/x.ts and the dev
// proxy sends it to Hono (404, blank page). Globs are lazy, so nothing here is imported.
describe('src/web layout', () => {
  it('has no top-level api/ folder (collides with the /api dev proxy)', () => {
    expect(Object.keys(import.meta.glob('./api/**/*'))).toEqual([]);
  });

  it('finds the http/ modules (sanity check that the glob above can match)', () => {
    expect(Object.keys(import.meta.glob('./http/*.ts'))).toContain('./http/client.ts');
  });
});
