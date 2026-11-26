import { EventBodySchema, type EventBody, type GateId } from '@explainer-studio/shared';
import { and, asc, desc, eq, gt, max, type SQL } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { events } from '../schema.ts';

type EventRow = typeof events.$inferSelect;

/** A stored event with `type` and `payload` correlated (discriminated by `type`). */
export type StoredEvent = Omit<EventRow, 'type' | 'payload'> & EventBody;

/** Who an event belongs to. At least one of the two is required (also a DB CHECK). */
export type EventOwner =
  | { readonly runId: number; readonly jobId?: number | null | undefined }
  | { readonly runId?: number | null | undefined; readonly jobId: number };

export type NewEvent = EventOwner & EventBody;

/** Rows are written by this app only, but parsing keeps `type` and `payload` correlated. */
function toStoredEvent(row: EventRow): StoredEvent {
  return { ...row, ...EventBodySchema.parse({ type: row.type, payload: row.payload }) };
}

/** Appends an event. The payload is validated against its type's schema first. */
export function appendEvent(db: Executor, event: NewEvent): StoredEvent {
  const body = EventBodySchema.parse({ type: event.type, payload: event.payload });
  const row = db
    .insert(events)
    .values({ runId: event.runId ?? null, jobId: event.jobId ?? null, ...body })
    .returning()
    .get();
  return toStoredEvent(row);
}

export function getEvent(db: Executor, id: number): StoredEvent | undefined {
  const row = db.select().from(events).where(eq(events.id, id)).get();
  return row ? toStoredEvent(row) : undefined;
}

/** Restricts events to one run or one job. Omitted means every event. */
export interface EventFilter {
  readonly runId?: number | undefined;
  readonly jobId?: number | undefined;
}

export interface EventCursor extends EventFilter {
  /** Exclusive lower bound on event id. */
  readonly afterId: number;
  readonly limit: number;
}

function filterCondition(filter: EventFilter): SQL | undefined {
  return and(
    filter.runId === undefined ? undefined : eq(events.runId, filter.runId),
    filter.jobId === undefined ? undefined : eq(events.jobId, filter.jobId),
  );
}

/** Events after the cursor, oldest first. Ids are monotonic, so they double as the SSE id. */
export function listEventsSince(db: Executor, cursor: EventCursor): StoredEvent[] {
  return db
    .select()
    .from(events)
    .where(and(gt(events.id, cursor.afterId), filterCondition(cursor)))
    .orderBy(asc(events.id))
    .limit(cursor.limit)
    .all()
    .map(toStoredEvent);
}

/** Id of the newest matching event, or 0 when there are none. */
export function latestEventId(db: Executor, filter: EventFilter = {}): number {
  return (
    db
      .select({ id: max(events.id) })
      .from(events)
      .where(filterCondition(filter))
      .get()?.id ?? 0
  );
}

export type GateEvent = StoredEvent & { type: 'gate' };

/** A run's `gate` events for one gate, newest first. */
export function gateEvents(db: Executor, runId: number, gate: GateId): GateEvent[] {
  return db
    .select()
    .from(events)
    .where(and(eq(events.runId, runId), eq(events.type, 'gate')))
    .orderBy(desc(events.id))
    .all()
    .map(toStoredEvent)
    .filter((e): e is GateEvent => e.type === 'gate' && e.payload.gate === gate);
}
