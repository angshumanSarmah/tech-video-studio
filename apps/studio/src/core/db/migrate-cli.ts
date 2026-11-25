/**
 * Entrypoint: `pnpm db:migrate` (migrations, default rows, seed asset library and references). Runs before the server and worker start (see `dev` / `start`),
 * so the two processes never race to migrate the shared database.
 */
import { loadConfig } from '../config.ts';
import { migrationsDirFor } from './client.ts';
import { NAMES_TO_AVOID_FILE } from '../services/reference-seed.ts';
import { prepareDatabase } from './prepare.ts';

const config = loadConfig();
const { dbPath, seeded, assets, references } = prepareDatabase(
  config.dataDir,
  migrationsDirFor(config.workspaceRoot),
);
// `--quiet` (the studio CLI): only what changed is printed.
const quiet = process.argv.includes('--quiet');
if (!quiet || seeded) console.log(`[db] migrated ${dbPath}${seeded ? ' (seeded defaults)' : ''}`);
if (assets.inserted + assets.updated > 0) {
  console.log(`[assets] seeded ${assets.inserted} new, refreshed ${assets.updated}`);
}
if (references.inserted + references.updated > 0) {
  console.log(`[references] seeded ${references.inserted} new, refreshed ${references.updated}`);
}
if (references.failed.length > 0) {
  console.warn(
    `[references] not ready: ${references.failed.join(', ')} (see pnpm studio references)`,
  );
}
if (!quiet) {
  for (const slot of references.openSlots) {
    console.log(`[references] name to fill in ${NAMES_TO_AVOID_FILE}: ${slot.slug}: ${slot.todo}`);
  }
}
