import type { LogLevel } from '@explainer-studio/shared';
import type { z } from 'zod';
import type { Job } from '#core/db/repositories/jobs.ts';

export interface JobContext<Payload> {
  readonly job: Job;
  /** `job.payload`, parsed by the handler's `payloadSchema`. */
  readonly payload: Payload;
  /** Throttled to 1 event per second per job; `pct: 100` always goes through. */
  readonly progress: (pct: number, message?: string) => void;
  readonly log: (level: LogLevel, message: string) => void;
  /**
   * Aborted on graceful shutdown. Pass it to long operations or call `throwIfAborted()`; a job
   * that throws after an abort is requeued without counting the attempt.
   */
  readonly signal: AbortSignal;
}

/**
 * A worker job type. Delivery is at-least-once (a job interrupted by a crash or shutdown runs
 * again), so `run` must be idempotent: write outputs so a rerun overwrites or skips them.
 */
export interface JobHandler<S extends z.ZodType = z.ZodType> {
  /** Matched against `jobs.type`. */
  readonly type: string;
  readonly description: string;
  readonly payloadSchema: S;
  /** Whether a failure of this job fails its run. Default true. */
  readonly failsRun?: boolean;
  run(ctx: JobContext<z.output<S>>): Promise<void>;
}

/** Identity helper that infers the payload type from the schema. */
export function defineJobHandler<S extends z.ZodType>(handler: JobHandler<S>): JobHandler<S> {
  return handler;
}
