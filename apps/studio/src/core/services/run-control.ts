import type { Db, Executor } from '../db/client.ts';
import { appendEvent } from '../db/repositories/events.ts';
import { cancelQueuedJobs } from '../db/repositories/jobs.ts';
import {
  listPartRuns,
  reopenFailedRun,
  setActiveRunStatus,
  setPipelineStep,
  TERMINAL_RUN_STATUSES,
  type Run,
} from '../db/repositories/runs.ts';
import { ConflictError } from '../errors.ts';
import { advanceRun } from '../orchestrator/advance.ts';
import { PIPELINE } from '../orchestrator/pipeline.ts';
import { requireRun } from '../orchestrator/snapshot.ts';
import { appendJobStatusEvents } from './jobs.ts';

/**
 * Cancel and resume (P1C.9 step 6). A cancel ends a run in one transaction: the run (and its
 * parts) cancelled, its queued jobs cancelled; a job already running is stopped by the worker,
 * which sees the cancelled run within about a second (`CANCEL_POLL_MS`), aborts the job's signal
 * and records it cancelled. A failed run resumes from the step it failed at: that step's job is
 * queued again, and resumable jobs reuse what they finished (the Generator's beat steps, a
 * repair's steps).
 */

const isTerminal = (run: Run) => (TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status);

export function cancelRun(db: Db, runId: number): Run {
  return db.transaction((tx) => {
    const run = requireRun(tx, runId);
    if (isTerminal(run)) {
      throw new ConflictError(`Run ${runId} is already ${run.status}: nothing to cancel.`);
    }
    cancelOne(tx, run);
    return requireRun(tx, runId);
  });
}

function cancelOne(tx: Executor, run: Run): void {
  const cancelled = setActiveRunStatus(tx, run.id, 'cancelled');
  if (!cancelled) return;
  appendEvent(tx, {
    runId: run.id,
    type: 'run_status',
    payload: { status: 'cancelled', step: cancelled.pipelineStep },
  });
  appendJobStatusEvents(tx, cancelQueuedJobs(tx, run.id));
  for (const part of listPartRuns(tx, run.id)) {
    if (!isTerminal(part)) cancelOne(tx, part);
  }
}

/**
 * A failed run goes on from its failed step: back to running at that step with no job, so the
 * orchestrator queues the step's job again. A parent whose part failed is resumed through the
 * part.
 */
export function resumeRun(db: Db, dataDir: string, runId: number): Run {
  return db.transaction((tx) => {
    const run = requireRun(tx, runId);
    if (run.status !== 'failed') {
      throw new ConflictError(`Run ${runId} is ${run.status}: only a failed run resumes.`);
    }
    if (PIPELINE[run.pipelineStep].kind === 'children') {
      throw new ConflictError(`Run ${runId} failed through a part: resume the part instead.`);
    }
    reopenFailedRun(tx, run.id);
    setPipelineStep(tx, run.id, run.pipelineStep, null);
    resumedEvent(tx, run.id, run.pipelineStep);
    reopenParent(tx, run);
    advanceRun(tx, dataDir, run.id);
    return requireRun(tx, runId);
  });
}

function resumedEvent(tx: Executor, runId: number, step: Run['pipelineStep']): void {
  appendEvent(tx, { runId, type: 'run_status', payload: { status: 'running', step } });
}

/** A part resumed: its parent, failed with it while waiting for its parts, waits again. */
function reopenParent(tx: Executor, part: Run): void {
  if (part.parentRunId === null) return;
  const parent = requireRun(tx, part.parentRunId);
  if (parent.status !== 'failed' || parent.pipelineStep !== 'children') return;
  reopenFailedRun(tx, parent.id);
  resumedEvent(tx, parent.id, 'children');
}
