/**
 * Entrypoint: `pnpm db:migrate`. Runs before the server and worker start (see `dev` / `start`),
 * so the two processes never race to migrate the shared database.
 */
import { loadConfig } from '../config.ts';
import { migrationsDirFor } from './client.ts';
import { prepareDatabase } from './prepare.ts';

const config = loadConfig();
const { dbPath, seeded } = prepareDatabase(config.dataDir, migrationsDirFor(config.workspaceRoot));
console.log(`[db] migrated ${dbPath}${seeded ? ' (seeded defaults)' : ''}`);
