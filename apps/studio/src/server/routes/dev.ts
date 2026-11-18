import type { JobDto } from '@explainer-studio/shared';
import { Hono } from 'hono';
import type { Db } from '#core/db/client.ts';
import { NOOP_JOB_TYPE, queueJob } from '#core/services/jobs.ts';
import { toJobDto } from '../dto.ts';

/**
 * Dev-only endpoints, mounted at `/api/dev` outside the production build. There is no generic
 * `POST /api/jobs`: real jobs are queued by the services that own them.
 */
export function createDevRoute(db: Db) {
  return new Hono().post('/noop-job', (c) => {
    const job = queueJob(db, { type: NOOP_JOB_TYPE });
    return c.json<JobDto>(toJobDto(job), 201);
  });
}
