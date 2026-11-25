import type { GateDecisionRecord, GateId } from '@explainer-studio/shared';
import type { Executor } from '../db/client.ts';
import { getEvent } from '../db/repositories/events.ts';
import { listJobsByStatus, type Job } from '../db/repositories/jobs.ts';
import { ConflictError, InvalidProposalError, NotFoundError } from '../errors.ts';
import { queueJobIn } from './jobs.ts';
import { proposalOfEvent } from './style-rules.ts';

/**
 * Style-rule proposals (P1C.10): opt-in per note. A person's gate decision with text (an approve,
 * reject or edit note, a regenerate's feedback) is a `gate` event carrying `decision`; asking
 * for a proposal queues a `propose_rule` job for that event. The job belongs to no run, so a
 * run's cost cap, cancel or pause never touches it, and its failure fails nothing else.
 */

export const PROPOSE_RULE_JOB_TYPE = 'propose_rule';

/** A person's gate decision with its note: what a proposal is made from. */
export interface NotedDecision {
  readonly eventId: number;
  readonly runId: number;
  readonly gate: GateId;
  readonly decision: GateDecisionRecord & { readonly note: string };
}

/** The decision event `eventId` with its note; `InvalidProposalError` for any other event. */
export function notedDecision(db: Executor, eventId: number): NotedDecision {
  const event = getEvent(db, eventId);
  if (!event) throw new NotFoundError('Event', eventId);
  if (event.type !== 'gate' || !event.payload.decision || event.runId === null) {
    throw new InvalidProposalError(`Event ${eventId} is not a person's decision at a gate.`);
  }
  const { decision, gate } = event.payload;
  const note = decision.note?.trim();
  if (!note) {
    throw new InvalidProposalError(
      `The ${decision.action} at gate ${gate} (event ${eventId}) has no note to propose a rule from.`,
    );
  }
  return { eventId, runId: event.runId, gate, decision: { ...decision, note } };
}

/**
 * Queues the Analyst for one decision's note. A rule already proposed from it, or a proposal
 * still queued or running for it, is a `ConflictError`.
 */
export function requestRuleProposal(tx: Executor, eventId: number): Job {
  notedDecision(tx, eventId);
  const existing = proposalOfEvent(tx, eventId);
  if (existing) {
    throw new ConflictError(`Rule ${existing.id} was already proposed from event ${eventId}.`);
  }
  const pending = [...listJobsByStatus(tx, 'queued'), ...listJobsByStatus(tx, 'running')].find(
    (job) => job.type === PROPOSE_RULE_JOB_TYPE && payloadEventId(job) === eventId,
  );
  if (pending) {
    throw new ConflictError(
      `A proposal for event ${eventId} is already queued (job ${pending.id}).`,
    );
  }
  return queueJobIn(tx, { type: PROPOSE_RULE_JOB_TYPE, payload: { eventId } });
}

function payloadEventId(job: Job): number | undefined {
  const payload = job.payload as { eventId?: unknown } | null;
  return typeof payload?.eventId === 'number' ? payload.eventId : undefined;
}
