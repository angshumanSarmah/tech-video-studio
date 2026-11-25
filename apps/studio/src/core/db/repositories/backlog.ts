import type { MissingPrimitiveRequest } from '@explainer-studio/shared';
import { and, eq } from 'drizzle-orm';
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
