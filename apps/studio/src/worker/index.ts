import { hostname } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '#core/config.ts';
import { ensureDataDirs } from '#core/data-dirs.ts';
import { closeDatabase, dbPathFor, openDatabase } from '#core/db/client.ts';
import { recoverStaleJobs } from '#core/services/jobs.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { createJobHandlers, createJobRegistry } from '#worker/jobs/registry.ts';
import { createLlmClient, createLlmTransport } from '#worker/llm/index.ts';
import { startPollLoop } from '#worker/poll-loop.ts';
import { runFfmpeg } from '#worker/render/ffmpeg.ts';
import { createRemotionEngine } from '#worker/render/remotion-engine.ts';
import { drainQueue } from '#worker/runner.ts';
import { createKokoroTts } from '#worker/tts/kokoro.ts';

const POLL_INTERVAL_MS = 1_000;

const config = loadConfig();
ensureDataDirs(config.dataDir);
const db = openDatabase(dbPathFor(config.dataDir));
// The Remotion bundle is built on the first render job and reused by every later one.
const tools = { engine: createRemotionEngine(), ffmpeg: runFfmpeg, settings: config.render };
// Kokoro starts on the first cache miss and is reused; closed on shutdown.
const { provider: tts } = createKokoroTts({
  workspaceRoot: config.workspaceRoot,
  dataDir: config.dataDir,
  python: config.tts.binaryPath,
  log: (message) => console.warn(`[worker] ${message}`),
});
// Every LLM call goes through this one client (logged and costed); a missing key fails the call.
const llm = createLlmClient({
  db,
  dataDir: config.dataDir,
  llm: config.llm,
  transport: createLlmTransport(config.llm),
});
const prompts = loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR));
const settings = {
  tts: config.tts,
  timing: config.timing,
  video: config.video,
  research: config.research,
  llm: config.llm,
};
const registry = createJobRegistry(
  createJobHandlers({ db, dataDir: config.dataDir, tools, tts, settings, llm, prompts }),
);
const workerId = `${hostname()}:${process.pid}`;
const shutdownController = new AbortController();

// Single worker: any job still `running` belongs to a previous process that died.
const recovered = recoverStaleJobs(db, { failsRun: (type) => registry.failsRun(type) });
if (recovered.requeued.length + recovered.failed.length > 0) {
  console.warn(
    `[worker] stale jobs: requeued ${recovered.requeued.length}, failed ${recovered.failed.length}`,
  );
}

const loop = startPollLoop({
  intervalMs: POLL_INTERVAL_MS,
  tick: () =>
    drainQueue({
      db,
      registry,
      workerId,
      signal: shutdownController.signal,
      onError: (message, error) => console.error(`[worker] ${message}`, error),
    }),
  onError: (error) => console.error('[worker] tick failed', error),
});

console.log(`[worker] ${workerId} ready (data dir: ${config.dataDir})`);

/** Aborts the running job (it is requeued, attempt refunded) and waits for it to settle. */
async function shutdown(): Promise<void> {
  shutdownController.abort(new Error('worker shutting down'));
  await loop.stop();
  await tts.close();
  closeDatabase(db);
  process.exit(0);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
