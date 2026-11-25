import { UsageQuerySchema, type UsageSummary } from '@explainer-studio/shared';
import { Hono } from 'hono';
import type { Db } from '#core/db/client.ts';
import { usageSummary } from '#core/services/usage-history.ts';
import { validate } from '../validate.ts';

/** Memory (P1C.10): the usage history over the last exported videos. Style rules come in M2. */
export function createMemoryRoute(db: Db) {
  return new Hono().get('/usage', validate('query', UsageQuerySchema), (c) => {
    const { videos } = c.req.valid('query');
    return c.json<UsageSummary>(usageSummary(db, videos));
  });
}
