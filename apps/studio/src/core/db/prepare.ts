import { seedAssets, type SeedAssetsResult } from '../assets/seed.ts';
import { ensureDataDirs } from '../data-dirs.ts';
import { closeDatabase, dbPathFor, migrateDatabase, openDatabase } from './client.ts';
import { seedDefaults } from './seed.ts';

export interface PrepareResult {
  readonly dbPath: string;
  readonly seeded: boolean;
  readonly assets: SeedAssetsResult;
}

/**
 * Creates the data layout, applies migrations and seeds defaults and the seed asset library
 * (`data/assets`). Idempotent.
 */
export function prepareDatabase(dataDir: string, migrationsDir: string): PrepareResult {
  ensureDataDirs(dataDir);
  const dbPath = dbPathFor(dataDir);
  const db = openDatabase(dbPath);
  try {
    migrateDatabase(db, migrationsDir);
    return { dbPath, seeded: seedDefaults(db), assets: seedAssets(db, dataDir) };
  } finally {
    closeDatabase(db);
  }
}
