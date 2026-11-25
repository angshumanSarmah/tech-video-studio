import type {
  DecidedBy,
  GateId,
  GateStatus,
  PipelineStepId,
  RunStatus,
} from '@explainer-studio/shared';
import type { Db, Executor } from '../db/client.ts';
import { appendEvent } from '../db/repositories/events.ts';
import { decideGate, getGate, openGate } from '../db/repositories/gates.ts';
import { getLatestSpecVersion } from '../db/repositories/spec-versions.ts';
import { listRunJobs } from '../db/repositories/jobs.ts';
import {
  listPartRuns,
  listRunsByStatus,
  setActiveRunStatus,
  setCurrentStage,
  setPipelineStep,
  setStepRequests,
  type Run,
} from '../db/repositories/runs.ts';
import { latestCuration } from '../services/curation.ts';
import { queueJobIn } from '../services/jobs.ts';
import { decide, type Action, type RunSnapshot } from './decide.ts';
import { EFFECTS } from './effects.ts';
import { PIPELINE, type JobVersion } from './pipeline.ts';
import { gateSubject, OrchestratorStateError, readRunSnapshot, requireRun } from './snapshot.ts';

/**
 * The run orchestrator (P1C.9): moves a run through `PIPELINE` until it has to wait (for a job, a
 * review, another run) or is over. It runs in the caller's transaction: the one that records a
 * job's end (the worker) or a gate decision (the server), so a crash never leaves a run between
 * steps. Everything it knows comes from the tables, so calling it again is always safe.
 */

/** More actions than any run needs in one go: a loop past it is a bug, not a long pipeline. */
const MAX_ACTIONS = 50;

export interface AdvanceOptions {
  /** Also move on the runs this one unblocks: its parent and its next part (default true). */
  readonly cascade?: boolean;
}

export function advanceRun(
  tx: Executor,
  dataDir: string,
  runId: number,
  options: AdvanceOptions = {},
): void {
  for (let i = 0; i < MAX_ACTIONS; i += 1) {
    const snapshot = safeSnapshot(tx, dataDir, runId);
    if (!snapshot) return;
    const action = decide(snapshot);
    if (action.kind === 'idle') break;
    const run = requireRun(tx, runId);
    if (!applySafely(tx, dataDir, run, action)) break;
  }
  if (options.cascade !== false) advanceRelated(tx, dataDir, requireRun(tx, runId));
}

/**
 * At worker startup: every run that should be moving but has no job queued or running (it was
 * started, or a decision recorded, by a process that stopped before advancing it).
 */
export function sweepRuns(db: Db, dataDir: string): number[] {
  const stalled = listRunsByStatus(db, ['queued', 'running']).filter(
    (run) => !listRunJobs(db, run.id).some((j) => j.status === 'queued' || j.status === 'running'),
  );
  for (const run of stalled) db.transaction((tx) => advanceRun(tx, dataDir, run.id));
  return stalled.map((r) => r.id);
}

function advanceRelated(tx: Executor, dataDir: string, run: Run): void {
  if (run.parentRunId === null) return;
  advanceRun(tx, dataDir, run.parentRunId, { cascade: false });
  const next = listPartRuns(tx, run.parentRunId).find((p) => p.partIndex === run.partIndex! + 1);
  if (next) advanceRun(tx, dataDir, next.id, { cascade: false });
}

/** A snapshot, or undefined after failing the run when its state cannot be read. */
function safeSnapshot(tx: Executor, dataDir: string, runId: number): RunSnapshot | undefined {
  try {
    return readRunSnapshot(tx, dataDir, runId);
  } catch (error) {
    if (!(error instanceof OrchestratorStateError)) throw error;
    fail(tx, requireRun(tx, runId), error.message);
    return undefined;
  }
}

/** Applies an action; false when the run now waits. A state problem fails the run, logged. */
function applySafely(tx: Executor, dataDir: string, run: Run, action: Action): boolean {
  try {
    return apply(tx, dataDir, run, action);
  } catch (error) {
    if (!(error instanceof OrchestratorStateError)) throw error;
    fail(tx, run, error.message);
    return false;
  }
}

function apply(tx: Executor, dataDir: string, run: Run, action: Action): boolean {
  switch (action.kind) {
    case 'idle':
      return false;
    case 'enqueue':
      enqueueStep(tx, dataDir, run, action.step);
      return false;
    case 'advance':
      moveTo(tx, run, action.to);
      return true;
    case 'effect':
      moveTo(tx, run, runEffect(tx, dataDir, run, action.step, action.then));
      return true;
    case 'open_gate':
    case 'carry_gate':
      openOrCarry(tx, dataDir, run, action.gate, action.kind === 'carry_gate');
      return true;
    case 'approve_gate':
      approve(tx, run, action.gate);
      return true;
    case 'await_review':
      setStatus(tx, run, 'awaiting_review');
      return false;
    case 'finish':
      if (action.status === 'done') setPipelineStep(tx, run.id, 'done', null);
      setStatus(tx, run, action.status);
      return false;
  }
}

function runEffect(
  tx: Executor,
  dataDir: string,
  run: Run,
  step: PipelineStepId,
  then: PipelineStepId,
): PipelineStepId {
  const effect = EFFECTS[step];
  if (!effect) throw new OrchestratorStateError(`Step ${step} has no transition.`);
  return effect(
    { tx, dataDir, run, advancePart: (id) => advanceRun(tx, dataDir, id, { cascade: false }) },
    then,
  );
}

function enqueueStep(tx: Executor, dataDir: string, run: Run, step: PipelineStepId): void {
  const definition = PIPELINE[step];
  if (definition.kind !== 'job') throw new OrchestratorStateError(`Step ${step} is not a job.`);
  const version = versionFor(tx, dataDir, run, definition.version);
  const { [step]: request, ...otherRequests } = run.stepRequests;
  const payload = {
    ...(version === undefined ? {} : { specVersionId: version }),
    ...definition.payload,
    ...request,
  };
  const job = queueJobIn(tx, { type: definition.jobType, runId: run.id, payload });
  if (request) setStepRequests(tx, run.id, otherRequests);
  setPipelineStep(tx, run.id, step, job.id);
  setCurrentStage(tx, run.id, definition.stage);
  if (run.status !== 'running') setStatus(tx, run, 'running');
}

/** The spec version a job step works on (undefined: the job takes none). */
function versionFor(
  tx: Executor,
  dataDir: string,
  run: Run,
  version: JobVersion,
): number | undefined {
  const required = (id: number | null | undefined, what: string): number => {
    if (!id) throw new OrchestratorStateError(`Run ${run.id} has no ${what}.`);
    return id;
  };
  switch (version) {
    case 'none':
      return undefined;
    case 'latest':
      return required(getLatestSpecVersion(tx, run.id)?.id, 'spec version');
    case 'curated':
      return required(
        latestCuration(tx, dataDir, run.id)?.report.final.specVersionId,
        'curated version',
      );
    case 'approved_scenes':
      return required(getGate(tx, run.id, 'scenes')?.specVersionId, 'approved scenes');
    case 'approved_draft':
      return required(getGate(tx, run.id, 'draft')?.specVersionId, 'approved draft');
  }
}

/**
 * The run enters `step` (with no job yet): a run_status event records it (the stage sequence of
 * the run). A run waiting for review is running again. Gate decisions use it to send a run back.
 */
export function moveTo(tx: Executor, run: Run, step: PipelineStepId): void {
  setPipelineStep(tx, run.id, step, null);
  const status = run.status === 'awaiting_review' ? 'running' : run.status;
  if (status !== run.status) setActiveRunStatus(tx, run.id, status);
  appendEvent(tx, { runId: run.id, type: 'run_status', payload: { status, step } });
}

/** Opens a gate on what it reviews now, or keeps an earlier approval for a new subject. */
function openOrCarry(tx: Executor, dataDir: string, run: Run, gate: GateId, carry: boolean): void {
  const subject = gateSubject(tx, dataDir, run, gate);
  const previous = getGate(tx, run.id, gate);
  openGate(tx, run.id, gate, subject);
  if (carry && previous) {
    decideGate(tx, run.id, gate, {
      status: 'approved',
      decidedBy: previous.decidedBy ?? 'auto',
      notes: previous.notes,
      carriedFrom: previous.carriedFrom,
    });
    gateEvent(tx, run, gate, 'approved', previous.decidedBy ?? 'auto', []);
    return;
  }
  const blocking = readRunSnapshot(tx, dataDir, run.id).blocking;
  gateEvent(tx, run, gate, 'pending', undefined, blocking);
}

function approve(tx: Executor, run: Run, gate: GateId): void {
  decideGate(tx, run.id, gate, { status: 'approved', decidedBy: 'auto' });
  gateEvent(tx, run, gate, 'approved', 'auto', []);
}

/** A gate opened or decided: the `gate` event. */
export function gateEvent(
  tx: Executor,
  run: Pick<Run, 'id'>,
  gate: GateId,
  status: GateStatus,
  decidedBy: DecidedBy | undefined,
  blocking: readonly string[],
): void {
  appendEvent(tx, {
    runId: run.id,
    type: 'gate',
    payload: { gate, status, ...(decidedBy ? { decidedBy } : {}), blocking: [...blocking] },
  });
}

function setStatus(tx: Executor, run: Run, status: RunStatus): void {
  const updated = setActiveRunStatus(tx, run.id, status);
  if (!updated) return;
  appendEvent(tx, {
    runId: run.id,
    type: 'run_status',
    payload: { status, step: updated.pipelineStep },
  });
}

function fail(tx: Executor, run: Run, message: string): void {
  appendEvent(tx, { runId: run.id, type: 'log', payload: { level: 'error', message } });
  setStatus(tx, run, 'failed');
}
