import type { RunEventPayload, RunEventType } from '@explainer-studio/shared';
import { and, asc, eq, gt, max } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { runEvents } from '../schema.ts';

export type RunEvent = typeof runEvents.$inferSelect;

export interface NewRunEvent {
  readonly runId: number;
  readonly jobId?: number;
  readonly type: RunEventType;
  readonly payload?: RunEventPayload;
}

export function appendRunEvent(db: Executor, event: NewRunEvent): RunEvent {
  return db
    .insert(runEvents)
    .values({
      runId: event.runId,
      jobId: event.jobId ?? null,
      type: event.type,
      payload: event.payload ?? {},
    })
    .returning()
    .get();
}

export interface RunEventCursor {
  /** Exclusive lower bound on event id. */
  readonly afterId: number;
  /** Only this run's events; omitted means all runs. */
  readonly runId?: number | undefined;
  readonly limit: number;
}

/** Events after the cursor, oldest first. Ids are monotonic, so they double as the SSE id. */
export function listRunEventsSince(db: Executor, cursor: RunEventCursor): RunEvent[] {
  const afterCursor = gt(runEvents.id, cursor.afterId);
  return db
    .select()
    .from(runEvents)
    .where(
      cursor.runId === undefined
        ? afterCursor
        : and(eq(runEvents.runId, cursor.runId), afterCursor),
    )
    .orderBy(asc(runEvents.id))
    .limit(cursor.limit)
    .all();
}

/** Id of the newest event, or 0 when there are none. */
export function latestRunEventId(db: Executor): number {
  return (
    db
      .select({ id: max(runEvents.id) })
      .from(runEvents)
      .get()?.id ?? 0
  );
}
