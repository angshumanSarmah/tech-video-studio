import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { jobs } from '../schema.ts';

export type Job = typeof jobs.$inferSelect;

export interface NewJob {
  /** Matched against the worker's handler registry when claimed (P0.5). */
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

export function listRunJobs(db: Executor, runId: number): Job[] {
  return db.select().from(jobs).where(eq(jobs.runId, runId)).orderBy(asc(jobs.id)).all();
}
