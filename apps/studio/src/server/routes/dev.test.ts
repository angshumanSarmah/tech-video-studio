import { JobDtoSchema } from '@explainer-studio/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { getJob } from '#core/db/repositories/jobs.ts';
import { NOOP_JOB_TYPE } from '#core/services/jobs.ts';
import { createTestServer, expectApiError, postJson, type TestServer } from '../testing.ts';

let s: TestServer | undefined;

afterEach(() => s?.cleanup());

describe('POST /api/dev/noop-job', () => {
  it('queues a run-less noop job and records it as queued', async () => {
    s = createTestServer({ enableDevRoutes: true });
    const res = await postJson(s.app, '/api/dev/noop-job', {});

    expect(res.status).toBe(201);
    const job = JobDtoSchema.parse(await res.json());
    expect(job).toMatchObject({ type: NOOP_JOB_TYPE, runId: null, status: 'queued' });
    expect(getJob(s.db, job.id)?.status).toBe('queued');
    const events = listEventsSince(s.db, { jobId: job.id, afterId: 0, limit: 10 });
    expect(events.map((e) => [e.type, e.payload])).toEqual([['job_status', { status: 'queued' }]]);
  });

  it('is not mounted unless dev routes are enabled', async () => {
    s = createTestServer();
    await expectApiError(await postJson(s.app, '/api/dev/noop-job', {}), 404, 'not_found');
  });
});
