import {
  SEED_ASSETS,
  SEED_SOURCE_PREFIX,
  serializeHouseSvg,
} from '@explainer-studio/renderer/catalog';
import type { LibraryAsset } from '@explainer-studio/shared';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { assetSvgPath, resolveDataPath, writeDataText } from '../data-files.ts';
import type { Db, Executor } from '../db/client.ts';
import { assets, seedState } from '../db/schema.ts';
import { lucideImportAssets, readLucideManifest } from './lucide-import.ts';

export type SeedAssetsResult = {
  inserted: number;
  updated: number;
  unchanged: number;
  /** Aliases added to rows (a seed alias the row did not have). */
  aliased: number;
  /** True when nothing changed since the last seeding, so the per-row pass was skipped. */
  skipped: boolean;
};

/** What seeding applies: approved assets, aliases (alias -> id) and the hash of their inputs. */
export interface AssetSeed {
  readonly assets: readonly LibraryAsset[];
  readonly aliases: Readonly<Record<string, string>>;
  readonly hash: string;
}

/** Bump when seeding writes rows differently, so every database reseeds once. */
export const ASSET_SEED_VERSION = 1;

const SEED_STATE_KEY = 'assets';

/**
 * The seed to apply: the core set (`SEED_ASSETS`) and, unless `importLucide` is false (tests),
 * the full Lucide import from the committed manifest. Aliases always come from the manifest
 * (they name core ids).
 */
export function assetSeed(
  options: { importLucide?: boolean; manifestPath?: string } = {},
): AssetSeed {
  const { text, manifest } = readLucideManifest(options.manifestPath);
  const importLucide = options.importLucide ?? true;
  const imported = importLucide ? lucideImportAssets(manifest) : [];
  const hash = createHash('sha256')
    .update(`v${ASSET_SEED_VERSION}\n`)
    .update(SEED_ASSETS.map((a) => `${a.id} ${a.source} ${a.styleVersion}`).join('\n'))
    .update(importLucide ? `\n${text}` : '\ncore only')
    .digest('hex');
  return { assets: [...SEED_ASSETS, ...imported], aliases: manifest.aliases, hash };
}

/**
 * Copies the seed into `<DATA_DIR>/assets` and the `assets` table (approved). Idempotent: when
 * the seed's hash is the one last applied and every file is in place, nothing is read or
 * written. Rows the seed did not create (drafted, uploaded) are never touched. A seeded row is
 * refreshed when its source or style version changed (a Lucide or house-style bump) or its file
 * is missing; its name, tags, family and status stay as the user left them. Seed aliases are
 * added to their rows when missing (an alias another row already declares is left out).
 */
export function seedAssets(
  db: Db,
  dataDir: string,
  seed: AssetSeed = assetSeed(),
): SeedAssetsResult {
  if (upToDate(db, dataDir, seed)) {
    return { inserted: 0, updated: 0, unchanged: seed.assets.length, aliased: 0, skipped: true };
  }
  return db.transaction((tx) => {
    const result = seedRows(tx, dataDir, seed.assets);
    const aliased = addSeedAliases(tx, seed.aliases);
    tx.insert(seedState)
      .values({ key: SEED_STATE_KEY, hash: seed.hash })
      .onConflictDoUpdate({
        target: seedState.key,
        set: { hash: seed.hash, updatedAt: new Date() },
      })
      .run();
    return { ...result, aliased, skipped: false };
  });
}

type AssetRow = typeof assets.$inferSelect;
type RowCounts = Pick<SeedAssetsResult, 'inserted' | 'updated' | 'unchanged'>;

function upToDate(db: Db, dataDir: string, seed: AssetSeed): boolean {
  const state = db.select().from(seedState).where(eq(seedState.key, SEED_STATE_KEY)).get();
  if (state?.hash !== seed.hash) return false;
  const dir = resolveDataPath(dataDir, 'assets');
  if (!existsSync(dir)) return false;
  const files = new Set(readdirSync(dir));
  return seed.assets.every((a) => files.has(`${a.id}.svg`));
}

function seedRows(
  tx: Executor,
  dataDir: string,
  seedAssetsList: readonly LibraryAsset[],
): RowCounts {
  const rows = new Map(
    tx
      .select()
      .from(assets)
      .all()
      .map((r) => [r.id, r]),
  );
  const counts: RowCounts = { inserted: 0, updated: 0, unchanged: 0 };
  for (const asset of seedAssetsList) {
    const row = rows.get(asset.id);
    if (!row) {
      insertSeed(tx, dataDir, asset);
      counts.inserted++;
    } else if (needsRefresh(row, asset, dataDir)) {
      refreshSeed(tx, dataDir, asset);
      counts.updated++;
    } else {
      counts.unchanged++;
    }
  }
  return counts;
}

function needsRefresh(row: AssetRow, asset: LibraryAsset, dataDir: string): boolean {
  if (!row.source.startsWith(SEED_SOURCE_PREFIX)) return false;
  return (
    row.source !== asset.source ||
    row.styleVersion < asset.styleVersion ||
    !existsSync(resolveDataPath(dataDir, row.svgPath))
  );
}

/** Adds each seed alias its target row lacks, unless any row has that id or alias already. */
function addSeedAliases(tx: Executor, aliases: Readonly<Record<string, string>>): number {
  const rows = new Map(
    tx
      .select()
      .from(assets)
      .all()
      .map((r) => [r.id, r]),
  );
  const taken = new Set([...rows.keys(), ...[...rows.values()].flatMap((r) => r.aliases)]);
  let added = 0;
  for (const [alias, target] of Object.entries(aliases)) {
    const row = rows.get(target);
    if (!row || taken.has(alias)) continue;
    row.aliases = [...row.aliases, alias].sort();
    tx.update(assets).set({ aliases: row.aliases }).where(eq(assets.id, target)).run();
    taken.add(alias);
    added++;
  }
  return added;
}

function writeSvg(dataDir: string, asset: LibraryAsset): string {
  return writeDataText(dataDir, assetSvgPath(asset.id), serializeHouseSvg(asset.shapes));
}

function insertSeed(tx: Executor, dataDir: string, asset: LibraryAsset): void {
  const svgPath = writeSvg(dataDir, asset);
  const { id, name, family, tags, styleVersion, licence, source } = asset;
  tx.insert(assets)
    .values({ id, name, family, tags, styleVersion, licence, source, svgPath, status: 'approved' })
    .run();
}

function refreshSeed(tx: Executor, dataDir: string, asset: LibraryAsset): void {
  const svgPath = writeSvg(dataDir, asset);
  const { styleVersion, licence, source } = asset;
  tx.update(assets)
    .set({ styleVersion, licence, source, svgPath })
    .where(eq(assets.id, asset.id))
    .run();
}
