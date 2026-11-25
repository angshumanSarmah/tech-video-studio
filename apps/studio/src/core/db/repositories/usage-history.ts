import type { UsageKind } from '@explainer-studio/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { usageHistory } from '../schema.ts';

export interface UsageValue {
  readonly runId: number;
  readonly kind: UsageKind;
  readonly value: string;
}

/**
 * Replaces a run's usage history with `rows` (P1C.10): recorded with its export, so a final
 * rendered again (at-least-once delivery, a re-export) leaves exactly the rows of its last spec.
 */
export function replaceRunUsage(
  db: Executor,
  runId: number,
  rows: readonly { readonly kind: UsageKind; readonly value: string }[],
): void {
  db.delete(usageHistory).where(eq(usageHistory.runId, runId)).run();
  if (rows.length === 0) return;
  db.insert(usageHistory)
    .values(rows.map((r) => ({ runId, kind: r.kind, value: r.value })))
    .run();
}

/** Usage rows of these runs, in insertion order. */
export function usageOfRuns(db: Executor, runIds: readonly number[]): UsageValue[] {
  if (runIds.length === 0) return [];
  return db
    .select({ runId: usageHistory.runId, kind: usageHistory.kind, value: usageHistory.value })
    .from(usageHistory)
    .where(inArray(usageHistory.runId, [...runIds]))
    .orderBy(asc(usageHistory.id))
    .all();
}
