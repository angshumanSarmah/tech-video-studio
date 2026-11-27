import { asc, eq, sql } from 'drizzle-orm';
import type { SpecAssetRequest } from '../../assets/run-asset-requests.ts';
import type { Executor } from '../client.ts';
import { assetRequests } from '../schema.ts';

export type AssetRequestRow = typeof assetRequests.$inferSelect;

/**
 * Records a run's asset requests (P1C.12), one row per id and run: a request the run recorded
 * before is refreshed (beats, description, family, closest), so recording again after a rerun or
 * a regenerate never duplicates a row. Returns the run's rows.
 */
export function recordAssetRequests(
  db: Executor,
  runId: number,
  requests: readonly SpecAssetRequest[],
): AssetRequestRow[] {
  for (const { assetId, beatIds, description, family, closest } of requests) {
    db.insert(assetRequests)
      .values({ assetId, runId, beatIds, description, family, closest })
      .onConflictDoUpdate({
        target: [assetRequests.assetId, assetRequests.runId],
        set: {
          beatIds,
          description,
          family,
          closest,
          updatedAt: sql`(cast(unixepoch('subsec') * 1000 as integer))`,
        },
      })
      .run();
  }
  return listRunAssetRequests(db, runId);
}

export function listRunAssetRequests(db: Executor, runId: number): AssetRequestRow[] {
  return db
    .select()
    .from(assetRequests)
    .where(eq(assetRequests.runId, runId))
    .orderBy(asc(assetRequests.id))
    .all();
}
