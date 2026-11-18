import { HealthResponseSchema } from '@explainer-studio/shared';
import { Hono } from 'hono';

export function createHealthRoute(uptimeSeconds: () => number) {
  return new Hono().get('/', (c) =>
    c.json(HealthResponseSchema.parse({ status: 'ok', uptimeSeconds: uptimeSeconds() })),
  );
}
