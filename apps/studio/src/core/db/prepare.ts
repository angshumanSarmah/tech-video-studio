import { assetSeed, seedAssets, type SeedAssetsResult } from '../assets/seed.ts';
import { ensureDataDirs } from '../data-dirs.ts';
import {
  defaultSeedReferencesDir,
  seedReferences,
  type SeedReferencesResult,
} from '../services/reference-seed.ts';
import { closeDatabase, dbPathFor, migrateDatabase, openDatabase } from './client.ts';
import { seedDefaults } from './seed.ts';

export interface PrepareResult {
  readonly dbPath: string;
  readonly seeded: boolean;
  readonly assets: SeedAssetsResult;
  readonly references: SeedReferencesResult;
}

const NO_ASSET_SEEDING: SeedAssetsResult = {
  inserted: 0,
  updated: 0,
  unchanged: 0,
  aliased: 0,
  skipped: true,
};

export interface PrepareOptions {
  /** The committed seed references (default: `apps/studio/seed/references`). */
  readonly seedReferencesDir?: string;
  /**
   * Which asset seed to apply: `all` (default: the core set and the full Lucide import from the
   * committed manifest), `core` (tests, `createTestDb`: no ~1,900 files per test database) or
   * `none` (a test on an older schema).
   */
  readonly assets?: 'all' | 'core' | 'none';
}

/**
 * Creates the data layout, applies migrations and seeds defaults, the seed asset library (the
 * core set and the Lucide import, `data/assets`) and the seed references (`data/references`).
 * Idempotent.
 */
export function prepareDatabase(
  dataDir: string,
  migrationsDir: string,
  options: PrepareOptions = {},
): PrepareResult {
  ensureDataDirs(dataDir);
  const dbPath = dbPathFor(dataDir);
  const db = openDatabase(dbPath);
  try {
    migrateDatabase(db, migrationsDir);
    const seeded = seedDefaults(db);
    const which = options.assets ?? 'all';
    const assets =
      which === 'none'
        ? NO_ASSET_SEEDING
        : seedAssets(db, dataDir, assetSeed({ importLucide: which === 'all' }));
    const references = seedReferences(
      db,
      dataDir,
      options.seedReferencesDir ?? defaultSeedReferencesDir(),
    );
    return { dbPath, seeded, assets, references };
  } finally {
    closeDatabase(db);
  }
}
