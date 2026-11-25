import { seedAssets, type SeedAssetsResult } from '../assets/seed.ts';
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

export interface PrepareOptions {
  /** The committed seed references (default: `apps/studio/seed/references`). */
  readonly seedReferencesDir?: string;
}

/**
 * Creates the data layout, applies migrations and seeds defaults, the seed asset library
 * (`data/assets`) and the seed references (`data/references`). Idempotent.
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
    const assets = seedAssets(db, dataDir);
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
