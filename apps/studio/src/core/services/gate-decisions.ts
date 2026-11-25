import type {
  GateDecisionRequest,
  GateId,
  GateIssue,
  GateSubjectDto,
  PipelineStepId,
  RunStatus,
} from '@explainer-studio/shared';
import type { Db, Executor } from '../db/client.ts';
import { decideGate, getGate } from '../db/repositories/gates.ts';
import { setHoldGate, type Run } from '../db/repositories/runs.ts';
import { getLatestSpecVersion } from '../db/repositories/spec-versions.ts';
import { ConflictError } from '../errors.ts';
import { advanceRun, gateEvent } from '../orchestrator/advance.ts';
import { requireRun } from '../orchestrator/snapshot.ts';
import { editAtGate } from './gate-edits.ts';
import { regenerateAtGate } from './gate-regenerate.ts';
import { currentSubject, subjectId, waitsAt } from './gates.ts';

/**
 * Decisions on a gate the run waits at (P1C.9 steps 4-5): approve, reject, edit, regenerate. Each
 * runs in one transaction with the orchestrator (`advanceRun`), so the run moves on, or goes back,
 * with the decision. The server and the CLI call this; neither holds any logic of its own.
 */

export type GateDecision = Exclude<GateDecisionRequest, { action: 'edit' }> | EditDecision;

interface EditDecision {
  readonly action: 'edit';
  readonly subjectId: number;
  readonly content: unknown;
}

export interface GateDecisionResult {
  readonly run: { readonly status: RunStatus; readonly step: PipelineStepId };
  readonly saved: GateSubjectDto | null;
  readonly issues: GateIssue[];
}

export function decideAtGate(
  db: Db,
  dataDir: string,
  runId: number,
  gate: GateId,
  decision: GateDecision,
): GateDecisionResult {
  return db.transaction((tx) => {
    const run = requireWaiting(tx, runId, gate);
    const outcome = apply(tx, dataDir, run, gate, decision);
    const after = requireRun(tx, runId);
    return { run: { status: after.status, step: after.pipelineStep }, ...outcome };
  });
}

type Outcome = Pick<GateDecisionResult, 'saved' | 'issues'>;
const NOTHING_SAVED: Outcome = { saved: null, issues: [] };

function apply(
  tx: Executor,
  dataDir: string,
  run: Run,
  gate: GateId,
  decision: GateDecision,
): Outcome {
  switch (decision.action) {
    case 'approve':
      requireCurrentSubject(tx, dataDir, run, gate, decision.subjectId);
      releaseHold(tx, run, gate);
      record(tx, run, gate, 'approved', decision.notes);
      advanceRun(tx, dataDir, run.id);
      return NOTHING_SAVED;
    case 'reject':
      releaseHold(tx, run, gate);
      record(tx, run, gate, 'rejected', decision.notes);
      advanceRun(tx, dataDir, run.id);
      return NOTHING_SAVED;
    case 'edit':
      requireCurrentSubject(tx, dataDir, run, gate, decision.subjectId);
      return editAtGate(tx, dataDir, run, gate, decision.content);
    case 'regenerate':
      regenerateAtGate(tx, dataDir, run, gate, decision);
      return NOTHING_SAVED;
  }
}

/** A gate held for review (`resume --only`) is released by its approval or rejection. */
function releaseHold(tx: Executor, run: Run, gate: GateId): void {
  if (run.holdGate === gate) setHoldGate(tx, run.id, null);
}

/** The run, stopped at this gate with the gate pending; a 409 otherwise. */
function requireWaiting(tx: Executor, runId: number, gate: GateId): Run {
  const run = requireRun(tx, runId);
  if (!waitsAt(run, gate) || getGate(tx, runId, gate)?.status !== 'pending') {
    throw new ConflictError(
      `Run ${runId} is not waiting at the ${gate} gate (it is ${run.status} at ${run.pipelineStep}).`,
    );
  }
  return run;
}

/**
 * The decision was made on what the gate reviews now: its subject, and for the scenes and draft
 * gates the run's latest spec version. A 409 otherwise (an edit or a rerun replaced it).
 */
function requireCurrentSubject(
  tx: Executor,
  dataDir: string,
  run: Run,
  gate: GateId,
  requested: number,
): void {
  const subject = currentSubject(tx, dataDir, run, gate);
  const row = getGate(tx, run.id, gate);
  const reviewed = row?.specVersionId ?? row?.subjectStepId ?? null;
  if (!subject || subjectId(subject) !== requested || reviewed !== requested) {
    const now = subject ? subjectId(subject) : 'nothing';
    throw new ConflictError(`The ${gate} gate reviews ${now} now, not ${requested}: reload it.`);
  }
  if (subject.specVersionId === undefined) return;
  const latest = getLatestSpecVersion(tx, run.id);
  if (latest?.id !== requested) {
    throw new ConflictError(
      `Spec version ${requested} is not the run's latest (version ${latest?.version} is): reload it.`,
    );
  }
}

function record(
  tx: Executor,
  run: Run,
  gate: GateId,
  status: 'approved' | 'rejected',
  notes: string | undefined,
): void {
  decideGate(tx, run.id, gate, { status, decidedBy: 'user', notes: notes ?? null });
  gateEvent(tx, run, gate, status, 'user', []);
}
