import { HealthResponseSchema } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

describe('server app', () => {
  it('GET /api/health returns the shared health contract', async () => {
    const app = createApp({ uptimeSeconds: () => 42 });
    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(await res.json())).toEqual({
      status: 'ok',
      uptimeSeconds: 42,
    });
  });

  it('returns 404 for unknown routes', async () => {
    const res = await createApp().request('/api/nope');
    expect(res.status).toBe(404);
  });
});
