import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/**
 * A connection or an open transaction. Repository functions take this so a service can compose
 * several of them in one transaction.
 */
export type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

export const DB_FILENAME = 'studio.db';

/** Generated SQL migrations, relative to the workspace root. */
export const MIGRATIONS_DIR = 'apps/studio/drizzle';

/** Server and worker share the file, so wait on locks instead of failing with SQLITE_BUSY. */
const BUSY_TIMEOUT_MS = 5_000;

export function dbPathFor(dataDir: string): string {
  return join(dataDir, DB_FILENAME);
}

export function migrationsDirFor(workspaceRoot: string): string {
  return join(workspaceRoot, MIGRATIONS_DIR);
}

/** Opens (or creates) the database with the pragmas every connection needs. */
export function openDatabase(dbPath: string): Db {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return drizzle({ client: sqlite, schema });
}

/**
 * Applies pending migrations. Run from one process only (see `migrate-cli.ts`).
 *
 * Foreign keys are off while they run: SQLite rebuilds a table to change a constraint (copy,
 * drop, rename), and dropping a table that rows elsewhere reference (`run_sources` → `sources`,
 * `restrict`) fails while they are on. A generated `PRAGMA foreign_keys=OFF` cannot do it, since
 * the migrator runs in a transaction, where that pragma does nothing. Every reference is checked
 * once the migrations are in.
 */
export function migrateDatabase(db: Db, migrationsDir: string): void {
  db.$client.pragma('foreign_keys = OFF');
  try {
    migrate(db, { migrationsFolder: migrationsDir });
    const broken = db.$client.pragma('foreign_key_check') as unknown[];
    if (broken.length > 0) {
      throw new Error(
        `Migrations left ${broken.length} broken references: ${JSON.stringify(broken)}`,
      );
    }
  } finally {
    db.$client.pragma('foreign_keys = ON');
  }
}

export function closeDatabase(db: Db): void {
  db.$client.close();
}
