import type { MissingPrimitiveRequest } from '@explainer-studio/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { missingPrimitiveRequests } from '../schema.ts';

export type BacklogRequest = typeof missingPrimitiveRequests.$inferSelect;

/**
 * Records a run's missing-primitive requests in the backlog, once each: a request whose name the
 * run has already recorded is skipped, so the orchestrator can record again after a rerun.
 * Returns the rows it added.
 */
export function recordMissingPrimitives(
  db: Executor,
  runId: number,
  requests: readonly MissingPrimitiveRequest[],
): BacklogRequest[] {
  const added: BacklogRequest[] = [];
  for (const request of requests) {
    const known = db
      .select({ id: missingPrimitiveRequests.id })
      .from(missingPrimitiveRequests)
      .where(
        and(
          eq(missingPrimitiveRequests.runId, runId),
          eq(missingPrimitiveRequests.name, request.name),
        ),
      )
      .get();
    if (known) continue;
    const description = `${request.description} (fallback used: ${request.fallbackUsed})`;
    added.push(
      db
        .insert(missingPrimitiveRequests)
        .values({ name: request.name, description, runId })
        .returning()
        .get(),
    );
  }
  return added;
}

export function listRunBacklog(db: Executor, runId: number): BacklogRequest[] {
  return db
    .select()
    .from(missingPrimitiveRequests)
    .where(eq(missingPrimitiveRequests.runId, runId))
    .all();
}

/** A backlog request a reference asks for: its name, what it shows and how buildable it is. */
export interface ReferenceBacklogItem {
  readonly name: string;
  readonly description: string;
}

/**
 * Makes a reference's backlog rows match its record's buildable unmapped items (P1C.11): a row
 * for each new name, an open row whose name left the record deleted, and a row someone has
 * already planned, built or rejected left as it is. Returns the rows it added.
 */
export function syncReferenceBacklog(
  db: Executor,
  referenceVideoId: number,
  items: readonly ReferenceBacklogItem[],
): BacklogRequest[] {
  const existing = listReferenceBacklog(db, referenceVideoId);
  const wanted = new Set(items.map((item) => item.name));
  for (const row of existing) {
    if (row.status === 'open' && !wanted.has(row.name)) {
      db.delete(missingPrimitiveRequests).where(eq(missingPrimitiveRequests.id, row.id)).run();
    }
  }
  const known = new Set(existing.map((row) => row.name));
  const added: BacklogRequest[] = [];
  for (const item of items) {
    if (known.has(item.name)) continue;
    known.add(item.name);
    added.push(
      db
        .insert(missingPrimitiveRequests)
        .values({ name: item.name, description: item.description, referenceVideoId })
        .returning()
        .get(),
    );
  }
  return added;
}

export function listReferenceBacklog(db: Executor, referenceVideoId: number): BacklogRequest[] {
  return db
    .select()
    .from(missingPrimitiveRequests)
    .where(eq(missingPrimitiveRequests.referenceVideoId, referenceVideoId))
    .orderBy(asc(missingPrimitiveRequests.id))
    .all();
}
