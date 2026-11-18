import { loadConfig } from '#core/config.ts';
import { ensureDataDirs } from '#core/data-dirs.ts';
import { closeDatabase, dbPathFor, openDatabase } from '#core/db/client.ts';
import { startPollLoop } from '#worker/poll-loop.ts';

const POLL_INTERVAL_MS = 1_000;

const config = loadConfig();
ensureDataDirs(config.dataDir);
const db = openDatabase(dbPathFor(config.dataDir));

// Placeholder tick: claiming and running rows of the `jobs` table (via `db`) lands in P0.5.
const idleTick = (): Promise<void> => Promise.resolve();

const loop = startPollLoop({
  intervalMs: POLL_INTERVAL_MS,
  tick: idleTick,
  onError: (error) => console.error('[worker] tick failed', error),
});

console.log(`[worker] ready (data dir: ${config.dataDir})`);

async function shutdown(): Promise<void> {
  await loop.stop();
  closeDatabase(db);
  process.exit(0);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
