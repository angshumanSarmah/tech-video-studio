import {
  GATE_IDS,
  type GateId,
  type PipelineStepId,
  type StepRequests,
} from '@explainer-studio/shared';
import type { Db, Executor } from '../db/client.ts';
import { appendEvent } from '../db/repositories/events.ts';
import { reopenGate } from '../db/repositories/gates.ts';
import { cancelQueuedJobs, listRunJobs } from '../db/repositories/jobs.ts';
import {
  listPartRuns,
  reopenFailedRun,
  restartRun,
  setActiveRunStatus,
  setHoldGate,
  setPipelineStep,
  setStepRequests,
  TERMINAL_RUN_STATUSES,
  type Run,
} from '../db/repositories/runs.ts';
import { ConflictError } from '../errors.ts';
import { advanceRun, moveTo } from '../orchestrator/advance.ts';
import { GATE_STEPS, isAfter, PIPELINE } from '../orchestrator/pipeline.ts';
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

// --- Rerun (`resume --from` / `--only`, P1C.9b) -------------------------------------------------

/** Steps a run can be sent back to: each agent's step and each render. */
export const RERUN_STEPS = [
  'ingest',
  'research',
  'direct',
  'script',
  'generate',
  'curate',
  'stills',
  'draft',
  'final',
] as const satisfies readonly PipelineStepId[];
export type RerunStep = (typeof RERUN_STEPS)[number];

export interface RerunOptions {
  readonly from: RerunStep;
  /**
   * Run only this step and what its gate needs (`--only`): the next gate waits for a review even
   * with auto-approve on, and a curate on the way does not repair (no other agent is called).
   */
  readonly only: boolean;
}

/**
 * Sends a run that is not busy (waiting at a gate, failed or done; never cancelled) back to a
 * step: every gate after it is reviewed again, gates before it keep their approvals. A rerun of
 * the Generator draws every board again (finished beat steps are not reused). A multi-part
 * video's parent reruns what it owns (up to the beat sheet); a part, from its script on.
 */
export function rerunRun(db: Db, dataDir: string, runId: number, options: RerunOptions): Run {
  return db.transaction((tx) => rerunRunIn(tx, dataDir, runId, options));
}

/** `rerunRun` inside a transaction the caller holds (a missing asset resolved, P1C.12 A5). */
export function rerunRunIn(
  tx: Executor,
  dataDir: string,
  runId: number,
  options: RerunOptions,
): Run {
  const run = requireRun(tx, runId);
  assertRerunnable(tx, run, options.from);
  for (const gate of GATE_IDS) {
    if (isAfter(GATE_STEPS[gate], options.from)) reopenGate(tx, run.id, gate);
  }
  setStepRequests(tx, run.id, rerunRequests(options));
  setHoldGate(tx, run.id, options.only ? nextGate(options.from) : null);
  restartRun(tx, run.id);
  reopenFinishedParent(tx, run);
  appendEvent(tx, {
    runId: run.id,
    type: 'log',
    payload: { level: 'info', message: describeRerun(options) },
  });
  moveTo(tx, requireRun(tx, run.id), options.from);
  advanceRun(tx, dataDir, run.id);
  return requireRun(tx, runId);
}

function assertRerunnable(tx: Executor, run: Run, from: RerunStep): void {
  if (run.status === 'cancelled') {
    throw new ConflictError(`Run ${run.id} was cancelled: start a new run instead.`);
  }
  const busy = listRunJobs(tx, run.id).filter(
    (j) => j.status === 'queued' || j.status === 'running',
  );
  if (busy.length > 0 || run.status === 'paused') {
    throw new ConflictError(
      `Run ${run.id} is busy (${run.status} at ${run.pipelineStep}): wait for it, or cancel it.`,
    );
  }
  const isParent = listPartRuns(tx, run.id).length > 0;
  if (isParent && isAfter(from, 'split')) {
    throw new ConflictError(`Run ${run.id} is split into parts: rerun ${from} on a part.`);
  }
  if (run.parentRunId !== null && !isAfter(from, 'split')) {
    throw new ConflictError(
      `Run ${run.id} is a part: rerun ${from} on its parent, run ${run.parentRunId}.`,
    );
  }
  if (run.status !== 'done' && isAfter(from, run.pipelineStep)) {
    throw new ConflictError(
      `Run ${run.id} has not reached ${from} yet (it is at ${run.pipelineStep}).`,
    );
  }
}

/** Pure: what the rerun's jobs get besides their usual payload. */
export function rerunRequests(options: RerunOptions): StepRequests {
  return {
    ...(options.from === 'generate' ? { generate: { redraw: true } } : {}),
    ...(options.only && isAfter('curate', options.from) ? { curate: { repair: false } } : {}),
  };
}

/** Pure: the first gate after a step, if any. */
export function nextGate(step: PipelineStepId): GateId | null {
  return GATE_IDS.find((gate) => isAfter(GATE_STEPS[gate], step)) ?? null;
}

/** A part rerun after its video finished: the parent waits for its parts again. */
function reopenFinishedParent(tx: Executor, run: Run): void {
  if (run.parentRunId === null) return;
  const parent = requireRun(tx, run.parentRunId);
  if (parent.status !== 'done' && parent.status !== 'failed') return;
  restartRun(tx, parent.id);
  setPipelineStep(tx, parent.id, 'children', null);
  resumedEvent(tx, parent.id, 'children');
}

function describeRerun({ from, only }: RerunOptions): string {
  const gate = only ? nextGate(from) : null;
  return only
    ? `Rerun of ${from} only${gate ? `: the ${gate} gate waits for a review` : ''}.`
    : `Rerun from ${from}: every later gate is reviewed again.`;
}
