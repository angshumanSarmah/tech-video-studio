import { isAbsolute, resolve } from 'node:path';
import { describeLock, isHeld, readWorkerLock } from '#core/services/worker-lock.ts';
import { startWorker, type WorkerRuntime } from '#worker/runtime.ts';
import { CliError, type CliContext } from './context.ts';

/**
 * Runs `body` with a worker in this process (P1C.9b). It takes the worker lock when it is free
 * and runs the jobs itself; when `pnpm dev` (or another CLI) holds it, it attaches: the other
 * worker runs the jobs and this one waits on standby (and takes over if that worker goes away).
 * A dry run never attaches to a live worker, nor a live run to a dry-run one.
 */
export async function withWorker<T>(
  ctx: CliContext,
  dryRun: string | undefined,
  body: (worker: WorkerRuntime) => Promise<T>,
): Promise<T> {
  const config =
    dryRun === undefined
      ? ctx.config
      : { ...ctx.config, llmDryRunDir: isAbsolute(dryRun) ? dryRun : resolve(ctx.io.cwd, dryRun) };
  assertSameMode(ctx, config.llmDryRunDir === null ? 'live' : 'dry_run');
  if (config.llmDryRunDir !== null) {
    ctx.io.err(`DRY RUN: LLM answers are replayed from ${config.llmDryRunDir}`);
  }
  const worker = startWorker({
    config,
    db: ctx.db,
    kind: 'cli',
    log: (level, message) => {
      if (level !== 'info') ctx.io.err(`  ${level === 'error' ? '✗' : '!'} worker: ${message}`);
    },
    ...(ctx.workerParts ? { parts: ctx.workerParts } : {}),
    onLock: (state) =>
      ctx.io.err(
        state.held
          ? 'Running jobs in this process (worker lock taken).'
          : `Attached: ${describeLock(state.holder)} runs the jobs; following the run here.`,
      ),
  });
  try {
    return await body(worker);
  } finally {
    await worker.stop();
  }
}

function assertSameMode(ctx: CliContext, mode: 'live' | 'dry_run'): void {
  const lock = readWorkerLock(ctx.db);
  if (!lock || !isHeld(lock, { host: lock.host }, new Date()) || lock.llmMode === mode) return;
  const want = mode === 'dry_run' ? 'a dry run' : 'live LLM calls';
  throw new CliError(
    `The worker lock is held by ${describeLock(lock)}, and its LLM mode does not match (this ` +
      `command asks for ${want}). Stop that worker first, or ${mode === 'dry_run' ? 'drop' : 'add'} --dry-run.`,
  );
}
