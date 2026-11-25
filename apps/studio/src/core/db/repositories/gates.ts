import type { DecidedBy, GateId, GateStatus } from '@explainer-studio/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { gates } from '../schema.ts';

export type Gate = typeof gates.$inferSelect;

/** What a gate reviews: a spec version (scenes, draft) or a step's output (research, beat sheet). */
export type GateSubject =
  | { readonly specVersionId: number; readonly subjectStepId?: never }
  | { readonly subjectStepId: number; readonly specVersionId?: never };

export function getGate(db: Executor, runId: number, gate: GateId): Gate | undefined {
  return db
    .select()
    .from(gates)
    .where(and(eq(gates.runId, runId), eq(gates.gate, gate)))
    .get();
}

export function listRunGates(db: Executor, runId: number): Gate[] {
  return db.select().from(gates).where(eq(gates.runId, runId)).orderBy(asc(gates.id)).all();
}

/**
 * Opens a gate for review of `subject`: inserts its row, or resets the existing one (a gate is
 * reviewed again after a regenerate) to pending with the new subject.
 */
export function openGate(db: Executor, runId: number, gate: GateId, subject: GateSubject): Gate {
  const values = {
    status: 'pending' as const,
    specVersionId: subject.specVersionId ?? null,
    subjectStepId: subject.subjectStepId ?? null,
    decidedBy: null,
    notes: null,
    decidedAt: null,
  };
  return db
    .insert(gates)
    .values({ runId, gate, ...values })
    .onConflictDoUpdate({ target: [gates.runId, gates.gate], set: values })
    .returning()
    .get();
}

export interface GateDecision {
  readonly status: Exclude<GateStatus, 'pending'>;
  readonly decidedBy: DecidedBy;
  readonly notes?: string | null;
}

/** Records a decision on a pending gate; undefined when there is no pending gate to decide. */
export function decideGate(
  db: Executor,
  runId: number,
  gate: GateId,
  decision: GateDecision,
): Gate | undefined {
  return db
    .update(gates)
    .set({
      status: decision.status,
      decidedBy: decision.decidedBy,
      notes: decision.notes ?? null,
      decidedAt: new Date(),
    })
    .where(and(eq(gates.runId, runId), eq(gates.gate, gate), eq(gates.status, 'pending')))
    .returning()
    .get();
}

/**
 * Sends a decided gate back to review (a regenerate reopens the deciding gate and every later
 * one). Its subject stays: the gate opens again on the rerun's new subject when the run gets
 * there. A gate never opened is left alone.
 */
export function reopenGate(db: Executor, runId: number, gate: GateId): void {
  db.update(gates)
    .set({ status: 'pending', decidedBy: null, notes: null, decidedAt: null })
    .where(and(eq(gates.runId, runId), eq(gates.gate, gate)))
    .run();
}
