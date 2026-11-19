import {
  SEED_ASSETS,
  SEED_SOURCE_PREFIX,
  serializeHouseSvg,
} from '@explainer-studio/renderer/catalog';
import type { LibraryAsset } from '@explainer-studio/shared';
import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { assetSvgPath, resolveDataPath, writeDataText } from '../data-files.ts';
import type { Db } from '../db/client.ts';
import { assets } from '../db/schema.ts';

export type SeedAssetsResult = { inserted: number; updated: number; unchanged: number };

type AssetRow = typeof assets.$inferSelect;

/**
 * Copies the seed library into `<DATA_DIR>/assets` and the `assets` table (approved). Idempotent.
 * Rows the seed did not create (drafted, uploaded) are never touched. A seeded row is refreshed
 * when its source or style version changed (a Lucide or house-style bump) or its file is
 * missing; its name, tags, family and status stay as the user left them.
 */
export function seedAssets(
  db: Db,
  dataDir: string,
  seed: readonly LibraryAsset[] = SEED_ASSETS,
): SeedAssetsResult {
  const result: SeedAssetsResult = { inserted: 0, updated: 0, unchanged: 0 };
  for (const asset of seed) {
    const row = db.select().from(assets).where(eq(assets.id, asset.id)).get();
    if (!row) {
      insertSeed(db, dataDir, asset);
      result.inserted++;
    } else if (needsRefresh(row, asset, dataDir)) {
      refreshSeed(db, dataDir, asset);
      result.updated++;
    } else {
      result.unchanged++;
    }
  }
  return result;
}

function needsRefresh(row: AssetRow, asset: LibraryAsset, dataDir: string): boolean {
  if (!row.source.startsWith(SEED_SOURCE_PREFIX)) return false;
  return (
    row.source !== asset.source ||
    row.styleVersion < asset.styleVersion ||
    !existsSync(resolveDataPath(dataDir, row.svgPath))
  );
}

function writeSvg(dataDir: string, asset: LibraryAsset): string {
  return writeDataText(dataDir, assetSvgPath(asset.id), serializeHouseSvg(asset.shapes));
}

function insertSeed(db: Db, dataDir: string, asset: LibraryAsset): void {
  const svgPath = writeSvg(dataDir, asset);
  const { id, name, family, tags, styleVersion, licence, source } = asset;
  db.insert(assets)
    .values({ id, name, family, tags, styleVersion, licence, source, svgPath, status: 'approved' })
    .run();
}

function refreshSeed(db: Db, dataDir: string, asset: LibraryAsset): void {
  const svgPath = writeSvg(dataDir, asset);
  const { styleVersion, licence, source } = asset;
  db.update(assets)
    .set({ styleVersion, licence, source, svgPath })
    .where(eq(assets.id, asset.id))
    .run();
}
