import type {
  GateDecisionRecord,
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
import { ConflictError, InvalidProposalError } from '../errors.ts';
import { advanceRun, gateEvent } from '../orchestrator/advance.ts';
import { requireRun } from '../orchestrator/snapshot.ts';
import { editAtGate } from './gate-edits.ts';
import { regenerateAtGate } from './gate-regenerate.ts';
import { currentSubject, subjectId, waitsAt } from './gates.ts';
import { requestRuleProposal } from './rule-proposals.ts';

/**
 * Decisions on a gate the run waits at (P1C.9 steps 4-5): approve, reject, edit, regenerate. Each
 * runs in one transaction with the orchestrator (`advanceRun`), so the run moves on, or goes back,
 * with the decision. Each writes one `gate` event carrying `decision` (P1C.10: what it was, its
 * note, what it was made on), and with `proposeRule` queues a style-rule proposal from its note.
 * The server and the CLI call this; neither holds any logic of its own.
 */

export type GateDecision = Exclude<GateDecisionRequest, { action: 'edit' }> | EditDecision;

interface EditDecision {
  readonly action: 'edit';
  readonly subjectId: number;
  readonly content: unknown;
  readonly notes?: string | undefined;
  readonly proposeRule?: boolean | undefined;
}

export interface GateDecisionResult {
  readonly run: { readonly status: RunStatus; readonly step: PipelineStepId };
  readonly saved: GateSubjectDto | null;
  readonly issues: GateIssue[];
  /** The `gate` event that records the decision. */
  readonly eventId: number;
  /** The `propose_rule` job queued with it (`proposeRule`), else null. */
  readonly proposalJobId: number | null;
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
    if (decision.proposeRule && !noteOf(decision)) {
      throw new InvalidProposalError(
        'A style rule is proposed from a note: give notes (or a regenerate’s feedback).',
      );
    }
    const outcome = apply(tx, dataDir, run, gate, decision);
    const proposalJobId = decision.proposeRule ? requestRuleProposal(tx, outcome.eventId).id : null;
    const after = requireRun(tx, runId);
    return {
      run: { status: after.status, step: after.pipelineStep },
      ...outcome,
      proposalJobId,
    };
  });
}

type Outcome = Pick<GateDecisionResult, 'saved' | 'issues' | 'eventId'>;

function apply(
  tx: Executor,
  dataDir: string,
  run: Run,
  gate: GateId,
  decision: GateDecision,
): Outcome {
  const record = recordOf(decision);
  switch (decision.action) {
    case 'approve': {
      requireCurrentSubject(tx, dataDir, run, gate, decision.subjectId);
      releaseHold(tx, run, gate);
      const eventId = decide(tx, run, gate, 'approved', record);
      advanceRun(tx, dataDir, run.id);
      return { saved: null, issues: [], eventId };
    }
    case 'reject': {
      releaseHold(tx, run, gate);
      const eventId = decide(tx, run, gate, 'rejected', record);
      advanceRun(tx, dataDir, run.id);
      return { saved: null, issues: [], eventId };
    }
    case 'edit': {
      requireCurrentSubject(tx, dataDir, run, gate, decision.subjectId);
      // The decision is recorded before the run moves on, with what the edit saved.
      let eventId: number | undefined;
      const onSaved = (saved: GateSubjectDto) => {
        eventId = pendingDecision(tx, run, gate, { ...record, savedId: saved.id });
      };
      const outcome = editAtGate(tx, dataDir, run, gate, decision.content, onSaved);
      return { ...outcome, eventId: eventId ?? pendingDecision(tx, run, gate, record) };
    }
    case 'regenerate': {
      // What was asked to change: the gate's subject when the request was made.
      const subject = currentSubject(tx, dataDir, run, gate);
      const made = subject ? { ...record, subjectId: subjectId(subject) } : record;
      const eventId = pendingDecision(tx, run, gate, made);
      regenerateAtGate(tx, dataDir, run, gate, decision, eventId);
      return { saved: null, issues: [], eventId };
    }
  }
}

/** The person's text on a decision: notes, or a regenerate's feedback. */
function noteOf(decision: GateDecision): string | undefined {
  const text = decision.action === 'regenerate' ? decision.feedback : decision.notes;
  return text?.trim() || undefined;
}

/** What the decision event records (`GateDecisionRecord`). */
function recordOf(decision: GateDecision): GateDecisionRecord {
  const note = noteOf(decision);
  const base = { action: decision.action, ...(note ? { note } : {}) };
  switch (decision.action) {
    case 'approve':
    case 'edit':
      return { ...base, subjectId: decision.subjectId };
    case 'reject':
      return base;
    case 'regenerate': {
      const { target, beatId, fields, sourceId } = decision;
      return {
        ...base,
        target,
        ...(beatId !== undefined ? { beatId } : {}),
        ...(fields ? { fields: [...fields] } : {}),
        ...(sourceId !== undefined ? { sourceId } : {}),
      };
    }
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

/** Approve or reject: the gate row decided, and its event with the decision. */
function decide(
  tx: Executor,
  run: Run,
  gate: GateId,
  status: 'approved' | 'rejected',
  record: GateDecisionRecord,
): number {
  decideGate(tx, run.id, gate, { status, decidedBy: 'user', notes: record.note ?? null });
  return gateEvent(tx, run, gate, status, 'user', [], record);
}

/** An edit or regenerate: the gate stays (or goes back to) pending; the event records it. */
function pendingDecision(tx: Executor, run: Run, gate: GateId, record: GateDecisionRecord): number {
  return gateEvent(tx, run, gate, 'pending', 'user', [], record);
}
