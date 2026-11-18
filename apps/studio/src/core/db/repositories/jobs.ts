import type { JobStatus } from '@explainer-studio/shared';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { jobs } from '../schema.ts';

export type Job = typeof jobs.$inferSelect;

export interface NewJob {
  /** Matched against the worker's handler registry when claimed. */
  readonly type: string;
  readonly runId?: number;
  readonly payload?: Record<string, unknown>;
}

/** Queues a job. Pass a transaction to enqueue atomically with the rows the job acts on. */
export function enqueueJob(db: Executor, job: NewJob): Job {
  return db
    .insert(jobs)
    .values({ type: job.type, runId: job.runId ?? null, payload: job.payload ?? {} })
    .returning()
    .get();
}

export function getJob(db: Executor, id: number): Job | undefined {
  return db.select().from(jobs).where(eq(jobs.id, id)).get();
}

export function listRunJobs(db: Executor, runId: number): Job[] {
  return db.select().from(jobs).where(eq(jobs.runId, runId)).orderBy(asc(jobs.id)).all();
}

export function listJobsByStatus(db: Executor, status: JobStatus): Job[] {
  return db.select().from(jobs).where(eq(jobs.status, status)).orderBy(asc(jobs.id)).all();
}

export interface ClaimOptions {
  /** Recorded in `locked_by`, e.g. `<host>:<pid>`. */
  readonly workerId: string;
  readonly now: Date;
}

/**
 * Atomically moves the next due job (oldest `run_after`, then id) from `queued` to `running`,
 * locks it and counts the attempt. A single UPDATE, so two claimers can never take the same job.
 */
export function claimNextJob(db: Executor, { workerId, now }: ClaimOptions): Job | undefined {
  const next = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, 'queued'), lte(jobs.runAfter, now)))
    .orderBy(asc(jobs.runAfter), asc(jobs.id))
    .limit(1);
  return db
    .update(jobs)
    .set({
      status: 'running',
      lockedAt: now,
      lockedBy: workerId,
      attempts: sql`${jobs.attempts} + 1`,
      error: null,
    })
    .where(and(eq(jobs.status, 'queued'), sql`${jobs.id} = (${next})`))
    .returning()
    .get();
}

/** Final or requeued state for a running job; always clears the lock. */
export interface JobRelease {
  readonly status: Exclude<JobStatus, 'running'>;
  readonly error?: string;
  /** Give back the attempt counted at claim (graceful abort). */
  readonly refundAttempt?: boolean;
}

/** Releases a running job. Returns undefined if the job is not running (already released). */
export function releaseJob(db: Executor, id: number, release: JobRelease): Job | undefined {
  return db
    .update(jobs)
    .set({
      status: release.status,
      error: release.error ?? null,
      lockedAt: null,
      lockedBy: null,
      ...(release.refundAttempt ? { attempts: sql`max(${jobs.attempts} - 1, 0)` } : {}),
    })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'running')))
    .returning()
    .get();
}
