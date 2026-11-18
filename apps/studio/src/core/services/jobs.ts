import type { Db, Executor } from '../db/client.ts';
import { appendEvent } from '../db/repositories/events.ts';
import {
  claimNextJob,
  enqueueJob,
  listJobsByStatus,
  releaseJob,
  type ClaimOptions,
  type Job,
  type JobRelease,
  type NewJob,
} from '../db/repositories/jobs.ts';
import { setActiveRunStatus } from '../db/repositories/runs.ts';

/**
 * Job lifecycle transitions. Each one updates the job and appends its `job_status` event in one
 * transaction, so the event log never disagrees with the `jobs` table.
 */

/** Job type of the worker's demo handler. Queued from `/api/dev` to exercise the pipeline. */
export const NOOP_JOB_TYPE = 'noop';

/** Hard crashes a job may cause before it is failed instead of requeued. */
export const MAX_JOB_ATTEMPTS = 3;

/**
 * Queues a job and records it as queued, so a client streaming the job sees it before the worker
 * claims it. For jobs that start alongside other rows (e.g. a run), use `enqueueJob` in that
 * transaction instead.
 */
export function queueJob(db: Db, job: NewJob): Job {
  return db.transaction((tx) => {
    const queued = enqueueJob(tx, job);
    appendJobStatus(tx, queued);
    return queued;
  });
}

/** Claims the next due job and records it as running. */
export function claimJob(db: Db, options: ClaimOptions): Job | undefined {
  return db.transaction((tx) => {
    const job = claimNextJob(tx, options);
    if (job) appendJobStatus(tx, job);
    return job;
  });
}

export function completeJob(db: Db, job: Job): Job | undefined {
  return db.transaction((tx) => release(tx, job, { status: 'done' }));
}

export interface FailOptions {
  /** Also fail the job's run (default). A handler opts out with `failsRun: false`. */
  readonly failsRun: boolean;
}

/** Marks the job failed and, unless opted out, fails its run if the run is still active. */
export function failJob(db: Db, job: Job, error: string, options: FailOptions): Job | undefined {
  return db.transaction((tx) => {
    const failed = release(tx, job, { status: 'failed', error });
    if (failed && options.failsRun && job.runId !== null) failRun(tx, job.runId, job.id);
    return failed;
  });
}

/**
 * Puts a running job back in the queue. A graceful abort (SIGTERM, watch restart) refunds the
 * attempt counted at claim, so only hard crashes count toward `MAX_JOB_ATTEMPTS`.
 */
export function requeueJob(db: Db, job: Job, options: { refundAttempt: boolean }): Job | undefined {
  return db.transaction((tx) =>
    release(tx, job, { status: 'queued', refundAttempt: options.refundAttempt }),
  );
}

export interface RecoveryOptions {
  /** Whether a failure of this job type fails its run (from the worker's handler registry). */
  readonly failsRun: (jobType: string) => boolean;
}

export interface RecoveryResult {
  readonly requeued: Job[];
  readonly failed: Job[];
}

/**
 * Releases jobs left `running` by a worker that died. Single-worker assumption: at startup every
 * running job is stale, so no lease or heartbeat is needed. A job that has already used
 * `MAX_JOB_ATTEMPTS` is failed so a job that crashes the worker cannot crash-loop it.
 */
export function recoverStaleJobs(db: Db, options: RecoveryOptions): RecoveryResult {
  const result: RecoveryResult = { requeued: [], failed: [] };
  for (const job of listJobsByStatus(db, 'running')) {
    if (job.attempts >= MAX_JOB_ATTEMPTS) {
      const error = `abandoned after ${job.attempts} attempts (worker stopped while running it)`;
      const failed = failJob(db, job, error, { failsRun: options.failsRun(job.type) });
      if (failed) result.failed.push(failed);
    } else {
      const requeued = requeueJob(db, job, { refundAttempt: false });
      if (requeued) result.requeued.push(requeued);
    }
  }
  return result;
}

function release(tx: Executor, job: Job, change: JobRelease): Job | undefined {
  const released = releaseJob(tx, job.id, change);
  if (released) appendJobStatus(tx, released);
  return released;
}

function appendJobStatus(tx: Executor, job: Job): void {
  appendEvent(tx, {
    runId: job.runId,
    jobId: job.id,
    type: 'job_status',
    payload: job.error === null ? { status: job.status } : { status: job.status, error: job.error },
  });
}

function failRun(tx: Executor, runId: number, jobId: number): void {
  const run = setActiveRunStatus(tx, runId, 'failed');
  if (run) appendEvent(tx, { runId, jobId, type: 'run_status', payload: { status: run.status } });
}
