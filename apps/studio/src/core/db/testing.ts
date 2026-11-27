import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsSchema, type Settings } from '@explainer-studio/shared';
import { findWorkspaceRoot } from '../workspace-root.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from './client.ts';
import { prepareDatabase, type PrepareOptions } from './prepare.ts';

/** Test-only helpers. Not imported by any entrypoint. */

/** App settings at their defaults: what a test run's settings snapshot resolves from. */
export const TEST_APP_SETTINGS: Settings = SettingsSchema.parse({});

export const TEST_MIGRATIONS_DIR = migrationsDirFor(findWorkspaceRoot(import.meta.dirname));

export interface TestDb {
  readonly db: Db;
  readonly dataDir: string;
  readonly cleanup: () => void;
}

/**
 * A fresh data dir with a migrated, seeded database (`options`: e.g. other seed references). The
 * asset library is the core seed set unless `assets` says otherwise.
 */
export function createTestDb(options: PrepareOptions = {}): TestDb {
  const dataDir = join(mkdtempSync(join(tmpdir(), 'studio-db-')), 'data');
  const { dbPath } = prepareDatabase(dataDir, TEST_MIGRATIONS_DIR, {
    assets: 'core',
    ...options,
  });
  const db = openDatabase(dbPath);
  return {
    db,
    dataDir,
    cleanup: () => {
      closeDatabase(db);
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
