import { ProgressPayloadSchema, type LogLevel } from '@explainer-studio/shared';
import { z } from 'zod';
import type { Db } from '#core/db/client.ts';
import { appendEvent } from '#core/db/repositories/events.ts';
import type { Job } from '#core/db/repositories/jobs.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { RunBudgetReachedError } from '#core/errors.ts';
import {
  cancelRunningJob,
  claimJob,
  completeJob,
  failJob,
  pauseForBudget,
  requeueJob,
  type AdvanceRun,
} from '#core/services/jobs.ts';
import type { JobContext, JobHandler } from './jobs/handler.ts';
import type { JobRegistry } from './jobs/registry.ts';
import { createProgressThrottle, type ProgressThrottle } from './progress.ts';

export const PROGRESS_INTERVAL_MS = 1_000;

/** How often a running job checks whether its run was cancelled. */
export const CANCEL_POLL_MS = 1_000;

export interface RunnerDeps {
  readonly db: Db;
  readonly registry: JobRegistry;
  /** Recorded in `jobs.locked_by`. */
  readonly workerId: string;
  /** Aborted on graceful shutdown. */
  readonly signal: AbortSignal;
  readonly progressIntervalMs?: number;
  /** How often a running job checks whether its run was cancelled (default `CANCEL_POLL_MS`). */
  readonly cancelPollMs?: number;
  /** Moves a run on when one of its jobs ends (the orchestrator); omitted, jobs run alone. */
  readonly advance?: AdvanceRun;
  readonly onError?: (message: string, error: unknown) => void;
}

/** Claims and runs one job. Resolves true if a job was claimed (whatever its outcome). */
export async function runNextJob(deps: RunnerDeps): Promise<boolean> {
  if (deps.signal.aborted) return false;
  const job = claimJob(deps.db, { workerId: deps.workerId, now: new Date() });
  if (!job) return false;
  await runClaimedJob(deps, job);
  return true;
}

/** Runs jobs back to back until the queue has nothing due or shutdown starts. */
export async function drainQueue(deps: RunnerDeps): Promise<void> {
  while (await runNextJob(deps)) {
    // keep going
  }
}

async function runClaimedJob(deps: RunnerDeps, job: Job): Promise<void> {
  const handler = deps.registry.get(job.type);
  if (!handler) {
    failJob(deps.db, job, `no handler for job type ${job.type}`, {
      failsRun: true,
      advance: deps.advance,
    });
    return;
  }
  const parsed = handler.payloadSchema.safeParse(job.payload);
  if (!parsed.success) {
    const error = `invalid payload for job type ${job.type}: ${z.prettifyError(parsed.error)}`;
    failJob(deps.db, job, error, { failsRun: handler.failsRun ?? true, advance: deps.advance });
    return;
  }
  await execute(deps, job, handler, parsed.data);
}

async function execute(
  deps: RunnerDeps,
  job: Job,
  handler: JobHandler,
  payload: unknown,
): Promise<void> {
  const throttle = createJobThrottle(deps, job);
  const stop = watchCancel(deps, job);
  try {
    await handler.run(createContext(deps, job, payload, throttle, stop.signal));
  } catch (error) {
    throttle.flush();
    settleThrownJob(deps, job, handler, error, stop.cancelled());
    return;
  } finally {
    stop.dispose();
  }
  throttle.flush();
  completeJob(deps.db, job, { advance: deps.advance });
}

/**
 * The job's own signal: aborted on shutdown, or once its run is cancelled (checked every
 * `cancelPollMs`, so a cancel ends the job within about a second).
 */
function watchCancel(deps: RunnerDeps, job: Job) {
  const controller = new AbortController();
  let cancelled = false;
  const onShutdown = () => controller.abort(deps.signal.reason);
  deps.signal.addEventListener('abort', onShutdown, { once: true });
  const check = () => {
    // A timer: a throw here would crash the worker, so a failed read stops the check instead.
    try {
      if (getRun(deps.db, job.runId!)?.status !== 'cancelled') return;
      cancelled = true;
      controller.abort(new Error(`Run ${job.runId} was cancelled.`));
    } catch (error) {
      if (timer) clearInterval(timer);
      deps.onError?.(`cancel check failed for job ${job.id}`, error);
    }
  };
  const timer =
    job.runId === null ? undefined : setInterval(check, deps.cancelPollMs ?? CANCEL_POLL_MS);
  return {
    signal: controller.signal,
    cancelled: () => cancelled,
    dispose: () => {
      if (timer) clearInterval(timer);
      deps.signal.removeEventListener('abort', onShutdown);
    },
  };
}

/**
 * How a throw ends a job: after a graceful shutdown it is requeued (attempt refunded); after its
 * run was cancelled it is cancelled; at the run's cost cap it is requeued and the run paused;
 * anything else fails it.
 */
function settleThrownJob(
  deps: RunnerDeps,
  job: Job,
  handler: JobHandler,
  error: unknown,
  cancelled: boolean,
): void {
  if (deps.signal.aborted) {
    requeueJob(deps.db, job, { refundAttempt: true });
  } else if (cancelled) {
    cancelRunningJob(deps.db, job);
  } else if (error instanceof RunBudgetReachedError) {
    pauseForBudget(deps.db, job, error.message);
  } else {
    failJob(deps.db, job, errorMessage(error), {
      failsRun: handler.failsRun ?? true,
      advance: deps.advance,
    });
  }
}

function createContext(
  deps: RunnerDeps,
  job: Job,
  payload: unknown,
  throttle: ProgressThrottle,
  signal: AbortSignal,
): JobContext<unknown> {
  return {
    job,
    payload,
    // Validated here, not at write time, so a bad value throws in the handler instead of a timer.
    progress: (pct, message) =>
      throttle.report(
        ProgressPayloadSchema.parse(message === undefined ? { pct } : { pct, message }),
      ),
    log: (level: LogLevel, message: string) =>
      appendEvent(deps.db, {
        runId: job.runId,
        jobId: job.id,
        type: 'log',
        payload: { level, message },
      }),
    signal,
  };
}

function createJobThrottle(deps: RunnerDeps, job: Job): ProgressThrottle {
  return createProgressThrottle({
    intervalMs: deps.progressIntervalMs ?? PROGRESS_INTERVAL_MS,
    write: (payload) => {
      // May run from a timer, where a throw would crash the worker: report and drop instead.
      try {
        appendEvent(deps.db, { runId: job.runId, jobId: job.id, type: 'progress', payload });
      } catch (error) {
        deps.onError?.(`progress write failed for job ${job.id}`, error);
      }
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
