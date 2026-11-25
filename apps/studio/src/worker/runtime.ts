import { join } from 'node:path';
import type { WorkerKind } from '@explainer-studio/shared';
import type { AppConfig } from '#core/config.ts';
import type { Db, Executor } from '#core/db/client.ts';
import { advanceRun, sweepRuns } from '#core/orchestrator/advance.ts';
import { recoverStaleJobs } from '#core/services/jobs.ts';
import {
  acquireWorkerLock,
  describeLock,
  LOCK_HEARTBEAT_MS,
  lockHolder,
  releaseWorkerLock,
  renewWorkerLock,
  type LockClock,
  type LockHolder,
  type WorkerLock,
} from '#core/services/worker-lock.ts';
import { loadPromptTemplates, PROMPTS_DIR } from './agents/prompts/templates.ts';
import { createJobHandlers, createJobRegistry } from './jobs/registry.ts';
import { createLlmClient, workerTransport } from './llm/index.ts';
import type { LlmTransport } from './llm/types.ts';
import { startPollLoop } from './poll-loop.ts';
import { runFfmpeg } from './render/ffmpeg.ts';
import { createRemotionEngine } from './render/remotion-engine.ts';
import type { RenderTools } from './render/target.ts';
import { runNextJob } from './runner.ts';
import { createKokoroTts } from './tts/kokoro.ts';
import type { TtsProvider } from './tts/provider.ts';

/**
 * A worker (P1C.9b): the job loop of the `pnpm dev` / `start` worker and of the studio CLI. Only
 * the holder of the worker lock claims jobs (`#core/services/worker-lock.ts`). A worker that
 * cannot take it waits on standby and tries again every `LOCK_HEARTBEAT_MS`; once it holds it,
 * it recovers stale jobs and sweeps stalled runs (both assume a single worker), then drains the
 * queue. A holder renews the lock on the same beat and stops claiming once it finds it taken.
 */

export interface WorkerParts {
  readonly tools: RenderTools;
  readonly tts: TtsProvider;
  readonly transport: LlmTransport;
}

export type WorkerLog = (level: 'info' | 'warn' | 'error', message: string) => void;

export interface WorkerOptions {
  readonly config: AppConfig;
  readonly db: Db;
  readonly kind: WorkerKind;
  readonly log: WorkerLog;
  /** Replaces what the worker builds from config (tests; nothing is started that is given). */
  readonly parts?: Partial<WorkerParts>;
  readonly pollIntervalMs?: number;
  readonly lockIntervalMs?: number;
  readonly clock?: LockClock;
  /** Called when this worker takes the lock, or learns who holds it (standby). */
  readonly onLock?: (state: LockState) => void;
}

export type LockState =
  { readonly held: true } | { readonly held: false; readonly holder: WorkerLock };

export interface WorkerRuntime {
  readonly holder: LockHolder;
  holdsLock(): boolean;
  /** Stops claiming, aborts the running job (it is requeued) and releases the lock. */
  stop(): Promise<void>;
}

const POLL_INTERVAL_MS = 1_000;

export function startWorker(options: WorkerOptions): WorkerRuntime {
  const { config, db, log } = options;
  const parts = buildParts(options);
  const llmMode = config.llmDryRunDir === null ? 'live' : 'dry_run';
  const holder = lockHolder(options.kind, llmMode);
  const llm = createLlmClient({
    db,
    dataDir: config.dataDir,
    llm: config.llm,
    transport: parts.transport,
  });
  const prompts = loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR));
  const registry = createJobRegistry(
    createJobHandlers({
      db,
      dataDir: config.dataDir,
      tts: parts.tts,
      tools: parts.tools,
      llm,
      prompts,
    }),
  );
  const advance = (tx: Executor, runId: number) => advanceRun(tx, config.dataDir, runId);
  const stopping = new AbortController();
  let held = false;
  let jobs = new AbortController();
  let standbyHolder: string | null = null;

  const takeOrRenew = () => {
    if (held) {
      if (renewWorkerLock(db, holder, options.clock)) return;
      held = false;
      jobs.abort(new Error('worker lock lost'));
      log('error', 'Another worker took the worker lock: this one stops claiming jobs.');
    }
    const result = acquireWorkerLock(db, holder, options.clock);
    if (!result.acquired) {
      if (standbyHolder !== result.holder.holder) {
        standbyHolder = result.holder.holder;
        log('info', `On standby: the worker lock is held by ${describeLock(result.holder)}.`);
        options.onLock?.({ held: false, holder: result.holder });
      }
      return;
    }
    held = true;
    standbyHolder = null;
    jobs = new AbortController();
    if (result.takenFrom) {
      log('warn', `Took the worker lock from ${describeLock(result.takenFrom)} (gone or silent).`);
    }
    recover();
    options.onLock?.({ held: true });
  };

  const recover = () => {
    const recovered = recoverStaleJobs(db, {
      failsRun: (type) => registry.failsRun(type),
      advance,
    });
    if (recovered.requeued.length + recovered.failed.length > 0) {
      log(
        'warn',
        `Stale jobs: requeued ${recovered.requeued.length}, failed ${recovered.failed.length}.`,
      );
    }
    const swept = sweepRuns(db, config.dataDir);
    if (swept.length > 0) log('warn', `Moved on stalled runs: ${swept.join(', ')}.`);
  };

  takeOrRenew();
  const lockTimer = setInterval(() => {
    try {
      takeOrRenew();
    } catch (error) {
      log('error', `Worker lock check failed: ${(error as Error).message}`);
    }
  }, options.lockIntervalMs ?? LOCK_HEARTBEAT_MS);

  const loop = startPollLoop({
    intervalMs: options.pollIntervalMs ?? POLL_INTERVAL_MS,
    tick: async () => {
      const signal = AbortSignal.any([stopping.signal, jobs.signal]);
      while (held && !signal.aborted) {
        const ran = await runNextJob({
          db,
          registry,
          workerId: holder.holder,
          advance,
          signal,
          onError: (message, error) => log('error', `${message}: ${String(error)}`),
        });
        if (!ran) return;
      }
    },
    onError: (error) => log('error', `Worker tick failed: ${String(error)}`),
  });

  return {
    holder,
    holdsLock: () => held,
    async stop() {
      clearInterval(lockTimer);
      stopping.abort(new Error('worker shutting down'));
      await loop.stop();
      if (held) releaseWorkerLock(db, holder);
      held = false;
      if (!options.parts?.tts) await parts.tts.close();
    },
  };
}

function buildParts(options: WorkerOptions): WorkerParts {
  const { config, parts = {} } = options;
  return {
    // The Remotion bundle is built on the first render job and reused by every later one.
    tools: parts.tools ?? {
      engine: createRemotionEngine(),
      ffmpeg: runFfmpeg,
      settings: config.render,
    },
    // Kokoro starts on the first cache miss and is reused; closed on stop.
    tts:
      parts.tts ??
      createKokoroTts({
        workspaceRoot: config.workspaceRoot,
        dataDir: config.dataDir,
        python: config.tts.binaryPath,
        log: (message) => options.log('warn', message),
      }).provider,
    // Every LLM call goes through one client (logged and costed); a missing key fails the call.
    transport: parts.transport ?? workerTransport(config).transport,
  };
}
