import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { enqueueJob, getJob } from '#core/db/repositories/jobs.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { series } from '#core/db/schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '#core/db/testing.ts';
import { claimJob, recoverStaleJobs } from '#core/services/jobs.ts';
import { startRun } from '#core/services/runs.ts';
import { defineJobHandler, type JobHandler } from './jobs/handler.ts';
import { noopJob } from './jobs/noop.ts';
import { createJobRegistry } from './jobs/registry.ts';
import { drainQueue, runNextJob, type RunnerDeps } from './runner.ts';

let t: TestDb;
let controller: AbortController;

beforeEach(() => {
  t = createTestDb();
  controller = new AbortController();
  // Ahead of real time, so jobs enqueued with SQLite's clock are already due.
  vi.useFakeTimers({ now: Date.now() + 60_000 });
});

afterEach(() => {
  vi.useRealTimers();
  t.cleanup();
});

function deps(handlers: JobHandler[] = [noopJob]): RunnerDeps {
  return {
    db: t.db,
    registry: createJobRegistry(handlers),
    workerId: 'test:1',
    signal: controller.signal,
  };
}

const jobEvents = (jobId: number) =>
  listEventsSince(t.db, { jobId, afterId: 0, limit: 100 }).map((e) => [e.type, e.payload]);

function startRunWithJob() {
  const topicId = createTopic(t.db, { title: 'Consistent hashing' }).id;
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'ai')).get()!.id;
  return startRun(t.db, { app: TEST_APP_SETTINGS, topicId, seriesId });
}

const failing = (opts: Partial<JobHandler>) =>
  defineJobHandler({
    type: 'explode',
    description: 'throws',
    payloadSchema: z.object({}),
    run: () => Promise.reject(new Error('kaboom')),
    ...opts,
  });

describe('runNextJob', () => {
  it('runs a queued noop job: 5 live progress events, then done', async () => {
    const job = enqueueJob(t.db, { type: 'noop' });

    const running = runNextJob(deps());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await running).toBe(true);

    expect(getJob(t.db, job.id)).toMatchObject({ status: 'done', attempts: 1, lockedBy: null });
    expect(jobEvents(job.id)).toEqual([
      ['job_status', { status: 'running' }],
      ['progress', { pct: 20, message: 'step 1/5' }],
      ['progress', { pct: 40, message: 'step 2/5' }],
      ['progress', { pct: 60, message: 'step 3/5' }],
      ['progress', { pct: 80, message: 'step 4/5' }],
      ['progress', { pct: 100, message: 'step 5/5' }],
      ['job_status', { status: 'done' }],
    ]);
  });

  it('flushes throttled progress before the final status', async () => {
    const job = enqueueJob(t.db, { type: 'burst' });
    const burst = defineJobHandler({
      type: 'burst',
      description: 'reports faster than the throttle',
      payloadSchema: z.object({}),
      run: ({ progress }) => {
        [10, 20, 30].forEach((pct) => progress(pct));
        return Promise.resolve();
      },
    });

    await runNextJob(deps([burst]));

    expect(jobEvents(job.id).map(([type, p]) => (type === 'progress' ? p : type))).toEqual([
      'job_status',
      { pct: 10 },
      { pct: 30 },
      'job_status',
    ]);
  });

  it('returns false when nothing is due', async () => {
    expect(await runNextJob(deps())).toBe(false);
  });

  it('fails an unknown job type clearly, and its run', async () => {
    const { run, job } = startRunWithJob(); // `ingest` has no handler yet

    await runNextJob(deps());

    expect(getJob(t.db, job.id)).toMatchObject({
      status: 'failed',
      error: 'no handler for job type ingest',
    });
    expect(getRun(t.db, run.id)?.status).toBe('failed');
  });

  it('fails a job whose payload does not match the schema', async () => {
    const job = enqueueJob(t.db, { type: 'noop', payload: { steps: 0 } });

    await runNextJob(deps());

    expect(getJob(t.db, job.id)?.error).toMatch(/^invalid payload for job type noop: .*steps/s);
  });

  it('fails the job and its run when the handler throws', async () => {
    const { run, job } = startRunWithJob();
    const handler = failing({ type: job.type });

    await runNextJob(deps([handler]));

    expect(getJob(t.db, job.id)).toMatchObject({ status: 'failed', error: 'kaboom' });
    expect(getRun(t.db, run.id)?.status).toBe('failed');
  });

  it('leaves the run alone when the handler opts out with failsRun: false', async () => {
    const { run, job } = startRunWithJob();

    await runNextJob(deps([failing({ type: job.type, failsRun: false })]));

    expect(getJob(t.db, job.id)?.status).toBe('failed');
    expect(getRun(t.db, run.id)?.status).toBe('running');
  });

  it('requeues a gracefully aborted job and refunds its attempt', async () => {
    const job = enqueueJob(t.db, { type: 'noop' });

    const running = runNextJob(deps());
    await vi.advanceTimersByTimeAsync(2_500);
    controller.abort(new Error('shutting down'));
    await running;

    expect(getJob(t.db, job.id)).toMatchObject({ status: 'queued', attempts: 0, lockedBy: null });
    expect(jobEvents(job.id).at(-1)).toEqual(['job_status', { status: 'queued' }]);
    expect(await runNextJob(deps())).toBe(false); // no new claims after shutdown starts
  });
});

describe('restart after a crash', () => {
  it('releases the stale lock on startup and runs the job to completion', async () => {
    const job = enqueueJob(t.db, { type: 'noop', payload: { steps: 2, stepMs: 0 } });
    claimJob(t.db, { workerId: 'dead:1', now: new Date() }); // worker dies mid-job

    const recovered = recoverStaleJobs(t.db, { failsRun: () => true });
    expect(recovered.requeued.map((j) => j.id)).toEqual([job.id]);

    const draining = drainQueue(deps());
    await vi.advanceTimersByTimeAsync(10);
    await draining;

    expect(getJob(t.db, job.id)).toMatchObject({ status: 'done', attempts: 2, lockedBy: null });
  });
});
