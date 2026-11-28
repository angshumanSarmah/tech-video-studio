import { specAssetUses } from '@explainer-studio/renderer/catalog';
import { toJsonPath, type GateBadge, type VideoSpec } from '@explainer-studio/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { assets } from '../db/schema.ts';

/**
 * The library ids a spec uses that are not approved (P1C.12 A5): drawn as placeholders, refused
 * by the final render. Read live against the `assets` table (an approval clears them at once).
 */

/** Library ids a spec uses that are not approved (logo slots aside), with each use. */
export function missingAssetUses(
  spec: VideoSpec,
  approved: ReadonlySet<string>,
): Map<string, { beatId: string; path: string }[]> {
  const slots = new Set((spec.logos ?? []).map((l) => l.id));
  const byId = new Map<string, { beatId: string; path: string }[]>();
  for (const use of specAssetUses(spec)) {
    if (approved.has(use.id) || slots.has(use.id)) continue;
    byId.set(use.id, [
      ...(byId.get(use.id) ?? []),
      { beatId: use.beatId, path: toJsonPath(use.path) },
    ]);
  }
  return byId;
}

/** Approved ids among `ids` (all approved ids when none are given). */
export function approvedIds(db: Executor, ids?: readonly string[]): Set<string> {
  const approved = eq(assets.status, 'approved');
  const rows = db
    .select({ id: assets.id })
    .from(assets)
    .where(ids ? and(approved, inArray(assets.id, [...ids])) : approved)
    .all();
  return new Set(rows.map((r) => r.id));
}

export function specUsedIds(spec: VideoSpec): string[] {
  return [...new Set(specAssetUses(spec).map((u) => u.id))];
}

/** The ids a spec still lacks, computed against the library now. */
export function specMissingAssets(db: Executor, spec: VideoSpec) {
  return missingAssetUses(spec, approvedIds(db, specUsedIds(spec)));
}

/** Gate 3 and 4's `asset_missing` badges: one per beat and missing id, read live. */
export function missingAssetBadges(db: Executor, runId: number, spec: VideoSpec): GateBadge[] {
  return [...specMissingAssets(db, spec)].flatMap(([id, uses]) =>
    [...new Set(uses.map((u) => u.beatId))].map((beatId) => ({
      beatId,
      source: 'code' as const,
      code: 'asset_missing',
      severity: 'advisory' as const,
      owner: 'generator' as const,
      message:
        `"${id}" is not in the library: it is drawn as a placeholder and the final render ` +
        `refuses it. Approve its draft, swap it or skip it: pnpm studio assets missing ${runId}`,
      needsPlanChange: false,
    })),
  );
}
