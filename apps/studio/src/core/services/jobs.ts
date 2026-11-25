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
import { getRun, setActiveRunStatus } from '../db/repositories/runs.ts';

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
  return db.transaction((tx) => queueJobIn(tx, job));
}

/** `queueJob` inside a transaction the caller holds (the orchestrator's). */
export function queueJobIn(tx: Executor, job: NewJob): Job {
  const queued = enqueueJob(tx, job);
  appendJobStatus(tx, queued);
  return queued;
}

/** Claims the next due job and records it as running; its run, if still queued, starts running. */
export function claimJob(db: Db, options: ClaimOptions): Job | undefined {
  return db.transaction((tx) => {
    const job = claimNextJob(tx, options);
    if (job) appendJobStatus(tx, job);
    if (job?.runId != null) startRunning(tx, job.runId, job.id);
    return job;
  });
}

/**
 * Moves a run on once one of its jobs is over (the orchestrator's `advanceRun`), in the same
 * transaction that records the job's end, so a crash never leaves a finished job unfollowed.
 */
export type AdvanceRun = (tx: Executor, runId: number) => void;

export interface ReleaseHooks {
  readonly advance?: AdvanceRun | undefined;
}

export function completeJob(db: Db, job: Job, hooks: ReleaseHooks = {}): Job | undefined {
  return db.transaction((tx) => {
    const done = release(tx, job, { status: 'done' });
    if (done && job.runId !== null) hooks.advance?.(tx, job.runId);
    return done;
  });
}

export interface FailOptions extends ReleaseHooks {
  /** Also fail the job's run (default). A handler opts out with `failsRun: false`. */
  readonly failsRun: boolean;
}

/**
 * Marks the job failed and, unless opted out, fails its run if the run is still active. A job
 * that does not fail its run (previews) lets the run move on.
 */
export function failJob(db: Db, job: Job, error: string, options: FailOptions): Job | undefined {
  return db.transaction((tx) => {
    const failed = release(tx, job, { status: 'failed', error });
    if (failed && job.runId !== null) {
      if (options.failsRun) failRun(tx, job.runId, job.id);
      else options.advance?.(tx, job.runId);
    }
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

/** A running job stopped because its run was cancelled: cancelled, not requeued. */
export function cancelRunningJob(db: Db, job: Job): Job | undefined {
  return db.transaction((tx) => release(tx, job, { status: 'cancelled' }));
}

/**
 * A job stopped by its run's cost cap (`RunBudgetReachedError`): requeued with its attempt
 * refunded, and the run paused with an event, in one transaction. The queue skips a paused run's
 * jobs, so it waits there until the cap is raised.
 */
export function pauseForBudget(db: Db, job: Job, message: string): Job | undefined {
  return db.transaction((tx) => {
    const requeued = release(tx, job, { status: 'queued', refundAttempt: true });
    if (job.runId === null) return requeued;
    const run = setActiveRunStatus(tx, job.runId, 'paused');
    if (run) {
      const payload = { status: run.status, step: run.pipelineStep };
      appendEvent(tx, { runId: run.id, jobId: job.id, type: 'run_status', payload });
      appendEvent(tx, {
        runId: run.id,
        jobId: job.id,
        type: 'log',
        payload: { level: 'warn', message },
      });
    }
    return requeued;
  });
}

/** Records jobs that changed outside `release` (cancelled while queued). */
export function appendJobStatusEvents(tx: Executor, changed: readonly Job[]): void {
  for (const job of changed) appendJobStatus(tx, job);
}

export interface RecoveryOptions extends ReleaseHooks {
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
      const failsRun = options.failsRun(job.type);
      const failed = failJob(db, job, error, { failsRun, advance: options.advance });
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

function startRunning(tx: Executor, runId: number, jobId: number): void {
  if (getRun(tx, runId)?.status !== 'queued') return;
  const run = setActiveRunStatus(tx, runId, 'running');
  if (run) {
    const payload = { status: run.status, step: run.pipelineStep };
    appendEvent(tx, { runId, jobId, type: 'run_status', payload });
  }
}

function failRun(tx: Executor, runId: number, jobId: number): void {
  const run = setActiveRunStatus(tx, runId, 'failed');
  if (run) appendEvent(tx, { runId, jobId, type: 'run_status', payload: { status: run.status } });
}
