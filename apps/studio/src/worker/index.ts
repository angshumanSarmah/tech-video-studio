import { loadConfig } from '#core/config.ts';
import { ensureDataDirs } from '#core/data-dirs.ts';
import { closeDatabase, dbPathFor, openDatabase } from '#core/db/client.ts';
import { startWorker } from '#worker/runtime.ts';

/**
 * The worker process (`pnpm dev`, `start`). It claims jobs while it holds the worker lock; while
 * a studio CLI holds it, it waits on standby and takes over when the CLI exits (P1C.9b).
 */

const config = loadConfig();
ensureDataDirs(config.dataDir);
const db = openDatabase(dbPathFor(config.dataDir));
if (config.llmDryRunDir !== null) {
  console.warn(`[worker] DRY RUN: LLM answers replayed from ${config.llmDryRunDir}`);
}
const worker = startWorker({
  config,
  db,
  kind: 'worker',
  log: (level, message) => console[level === 'info' ? 'log' : level](`[worker] ${message}`),
});

console.log(`[worker] ${worker.holder.holder} ready (data dir: ${config.dataDir})`);

/** Aborts the running job (it is requeued, attempt refunded) and waits for it to settle. */
async function shutdown(): Promise<void> {
  await worker.stop();
  closeDatabase(db);
  process.exit(0);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
