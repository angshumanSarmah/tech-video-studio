import { hostname } from 'node:os';
import type { LlmMode, WorkerKind } from '@explainer-studio/shared';
import { eq } from 'drizzle-orm';
import type { Db, Executor } from '../db/client.ts';
import { workerLock } from '../db/schema.ts';

/**
 * The worker lock (P1C.9b): only its holder claims jobs. Crash recovery (every `running` job is
 * stale) is only safe with one worker, and the CLI can start a worker in its own process next to
 * `pnpm dev`'s. A worker takes the lock when it is free, when its holder's heartbeat is older than
 * `LOCK_STALE_MS`, or when its holder's process is gone on this host; else it waits on standby
 * (a CLI then only follows the run: it attaches). The holder renews the heartbeat every
 * `LOCK_HEARTBEAT_MS` and stops claiming jobs once a renewal finds the lock taken.
 */

export const LOCK_HEARTBEAT_MS = 5_000;
export const LOCK_STALE_MS = 30_000;

export interface LockHolder {
  readonly holder: string;
  readonly host: string;
  readonly pid: number;
  readonly kind: WorkerKind;
  readonly llmMode: LlmMode;
}

export type WorkerLock = typeof workerLock.$inferSelect;

let instances = 0;

/** This process's identity for a new worker (unique per worker, even two in one process). */
export function lockHolder(kind: WorkerKind, llmMode: LlmMode): LockHolder {
  instances += 1;
  const host = hostname();
  return { holder: `${host}:${process.pid}:${instances}`, host, pid: process.pid, kind, llmMode };
}

export interface LockClock {
  readonly now?: () => Date;
  /** Whether a process of this host is alive (default: signal 0). */
  readonly isAlive?: (pid: number) => boolean;
}

export type AcquireResult =
  | { readonly acquired: true; readonly takenFrom: WorkerLock | null }
  | { readonly acquired: false; readonly holder: WorkerLock };

/** Takes the lock if it is free, ours, stale or its process is gone; else names the holder. */
export function acquireWorkerLock(db: Db, me: LockHolder, clock: LockClock = {}): AcquireResult {
  const now = (clock.now ?? (() => new Date()))();
  return db.transaction((tx) => {
    const current = readWorkerLock(tx);
    if (current && current.holder !== me.holder && isHeld(current, me, now, clock)) {
      return { acquired: false, holder: current };
    }
    tx.delete(workerLock).run();
    tx.insert(workerLock)
      .values({ id: 1, ...me, acquiredAt: now, heartbeatAt: now })
      .run();
    return { acquired: true, takenFrom: current && current.holder !== me.holder ? current : null };
  });
}

/** Renews the heartbeat; false when another worker has taken the lock. */
export function renewWorkerLock(db: Db, me: LockHolder, clock: LockClock = {}): boolean {
  const now = (clock.now ?? (() => new Date()))();
  const updated = db
    .update(workerLock)
    .set({ heartbeatAt: now })
    .where(eq(workerLock.holder, me.holder))
    .returning()
    .all();
  return updated.length > 0;
}

export function releaseWorkerLock(db: Db, me: LockHolder): void {
  db.delete(workerLock).where(eq(workerLock.holder, me.holder)).run();
}

export function readWorkerLock(db: Executor): WorkerLock | undefined {
  return db.select().from(workerLock).get();
}

/** The holder still holds it: its heartbeat is recent and, on this host, its process lives. */
export function isHeld(
  lock: WorkerLock,
  me: Pick<LockHolder, 'host'>,
  now: Date,
  clock: LockClock = {},
): boolean {
  if (now.getTime() - lock.heartbeatAt.getTime() > LOCK_STALE_MS) return false;
  if (lock.host !== me.host) return true;
  return (clock.isAlive ?? processAlive)(lock.pid);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** One line: who holds the lock and since when. */
export function describeLock(lock: WorkerLock): string {
  const who = lock.kind === 'cli' ? 'a studio CLI' : 'the worker (pnpm dev or start)';
  const mode = lock.llmMode === 'dry_run' ? ', dry run' : '';
  return `${who}, pid ${lock.pid} on ${lock.host}${mode}`;
}
