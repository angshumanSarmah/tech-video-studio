import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findWorkspaceRoot } from '../workspace-root.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from './client.ts';
import { prepareDatabase } from './prepare.ts';

/** Test-only helpers. Not imported by any entrypoint. */

export const TEST_MIGRATIONS_DIR = migrationsDirFor(findWorkspaceRoot(import.meta.dirname));

export interface TestDb {
  readonly db: Db;
  readonly dataDir: string;
  readonly cleanup: () => void;
}

/** A fresh data dir with a migrated, seeded database. */
export function createTestDb(): TestDb {
  const dataDir = join(mkdtempSync(join(tmpdir(), 'studio-db-')), 'data');
  const { dbPath } = prepareDatabase(dataDir, TEST_MIGRATIONS_DIR);
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
