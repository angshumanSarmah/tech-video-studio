import { SeriesListResponseSchema } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from '../testing.ts';

let s: TestServer;

beforeEach(() => {
  s = createTestServer();
});

afterEach(() => s.cleanup());

describe('GET /api/series', () => {
  it('lists the seeded series with their HUD labels', async () => {
    const res = await s.app.request('/api/series');

    expect(res.status).toBe(200);
    const { items } = SeriesListResponseSchema.parse(await res.json());
    expect(items).toEqual([
      expect.objectContaining({
        name: 'System Design',
        tag: 'system-design',
        label: 'SYSTEM DESIGN',
      }),
      expect.objectContaining({ name: 'AI', tag: 'ai', label: 'AI' }),
    ]);
    expect(items[0]?.accentColour).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
