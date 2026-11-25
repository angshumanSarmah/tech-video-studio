import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listEventsSince } from '../db/repositories/events.ts';
import { enqueueJob, getJob, type Job } from '../db/repositories/jobs.ts';
import { getRun, setActiveRunStatus } from '../db/repositories/runs.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { jobs, series } from '../db/schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import {
  claimJob,
  completeJob,
  failJob,
  MAX_JOB_ATTEMPTS,
  queueJob,
  recoverStaleJobs,
  requeueJob,
} from './jobs.ts';
import { startRun } from './runs.ts';

let t: TestDb;
let runId: number;
let runJob: Job;

beforeEach(() => {
  t = createTestDb();
  const topicId = createTopic(t.db, { title: 'Backpressure' }).id;
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'ai')).get()!.id;
  ({
    run: { id: runId },
    job: runJob,
  } = startRun(t.db, { app: TEST_APP_SETTINGS, topicId, seriesId }));
});

afterEach(() => t.cleanup());

const claim = () => claimJob(t.db, { workerId: 'host:1', now: new Date(Date.now() + 60_000) })!;
const eventsOf = (filter: { runId?: number; jobId?: number }) =>
  listEventsSince(t.db, { ...filter, afterId: 0, limit: 100 }).map((e) => [e.type, e.payload]);

describe('job lifecycle', () => {
  it('queueJob records the queued job as a job_status event', () => {
    const job = queueJob(t.db, { type: 'noop' });

    expect(job).toMatchObject({ type: 'noop', runId: null, status: 'queued' });
    expect(eventsOf({ jobId: job.id })).toEqual([['job_status', { status: 'queued' }]]);
  });

  it('records claim and completion as job_status events; the claim starts the run', () => {
    const job = claim();
    completeJob(t.db, job);

    expect(getJob(t.db, job.id)).toMatchObject({ status: 'done', lockedBy: null });
    expect(getRun(t.db, runId)?.status).toBe('running');
    expect(eventsOf({ jobId: job.id })).toEqual([
      ['run_status', { status: 'queued', step: 'ingest' }],
      ['job_status', { status: 'running' }],
      ['run_status', { status: 'running', step: 'ingest' }],
      ['job_status', { status: 'done' }],
    ]);
  });

  it('moves the run on in the transaction that completes its job (the orchestrator hook)', () => {
    const job = claim();
    const advanced: number[] = [];
    completeJob(t.db, job, { advance: (_tx, id) => advanced.push(id) });
    expect(advanced).toEqual([runId]);
  });

  it('fails the run with the job by default', () => {
    const job = claim();
    failJob(t.db, job, 'boom', { failsRun: true });

    expect(getRun(t.db, runId)?.status).toBe('failed');
    expect(eventsOf({ runId }).slice(-2)).toEqual([
      ['job_status', { status: 'failed', error: 'boom' }],
      ['run_status', { status: 'failed' }],
    ]);
  });

  it('leaves the run running, and moves it on, when the handler opts out', () => {
    const advanced: number[] = [];
    failJob(t.db, claim(), 'boom', { failsRun: false, advance: (_tx, id) => advanced.push(id) });
    expect(getRun(t.db, runId)?.status).toBe('running');
    expect(advanced).toEqual([runId]);
  });

  it('does not touch a run that already finished', () => {
    setActiveRunStatus(t.db, runId, 'cancelled');
    failJob(t.db, claim(), 'boom', { failsRun: true });

    expect(getRun(t.db, runId)?.status).toBe('cancelled');
    expect(eventsOf({ runId }).filter(([type]) => type === 'run_status')).toHaveLength(1);
  });

  it('handles jobs without a run', () => {
    t.db.delete(jobs).run();
    const loose = enqueueJob(t.db, { type: 'noop' });
    failJob(t.db, claim(), 'boom', { failsRun: true });

    expect(eventsOf({ jobId: loose.id }).at(-1)).toEqual([
      'job_status',
      { status: 'failed', error: 'boom' },
    ]);
  });

  it('requeues with or without refunding the attempt', () => {
    requeueJob(t.db, claim(), { refundAttempt: true });
    expect(getJob(t.db, runJob.id)).toMatchObject({ status: 'queued', attempts: 0 });

    requeueJob(t.db, claim(), { refundAttempt: false });
    expect(getJob(t.db, runJob.id)).toMatchObject({ status: 'queued', attempts: 1 });
  });
});

describe('recoverStaleJobs', () => {
  const failsRun = () => true;

  it('requeues a job left running by a crashed worker, keeping the attempt', () => {
    claim(); // the worker dies here

    const result = recoverStaleJobs(t.db, { failsRun });

    expect(result.requeued.map((j) => j.id)).toEqual([runJob.id]);
    expect(getJob(t.db, runJob.id)).toMatchObject({
      status: 'queued',
      attempts: 1,
      lockedBy: null,
    });
    expect(eventsOf({ jobId: runJob.id }).at(-1)).toEqual(['job_status', { status: 'queued' }]);
  });

  it(`fails a job after ${MAX_JOB_ATTEMPTS} hard crashes`, () => {
    for (let i = 0; i < MAX_JOB_ATTEMPTS; i++) {
      claim();
      if (i < MAX_JOB_ATTEMPTS - 1) recoverStaleJobs(t.db, { failsRun });
    }

    const result = recoverStaleJobs(t.db, { failsRun });

    expect(result.failed.map((j) => j.id)).toEqual([runJob.id]);
    expect(getJob(t.db, runJob.id)).toMatchObject({
      status: 'failed',
      error: `abandoned after ${MAX_JOB_ATTEMPTS} attempts (worker stopped while running it)`,
    });
    expect(getRun(t.db, runId)?.status).toBe('failed');
  });

  it('leaves queued and finished jobs alone', () => {
    const result = recoverStaleJobs(t.db, { failsRun });
    expect(result).toEqual({ requeued: [], failed: [] });
    expect(getJob(t.db, runJob.id)).toMatchObject({ status: 'queued', attempts: 0 });
  });
});
