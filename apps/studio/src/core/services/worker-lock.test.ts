import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/testing.ts';
import {
  acquireWorkerLock,
  LOCK_STALE_MS,
  lockHolder,
  readWorkerLock,
  releaseWorkerLock,
  renewWorkerLock,
  type LockHolder,
} from './worker-lock.ts';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

const at = (ms: number) => ({ now: () => new Date(1_700_000_000_000 + ms), isAlive: () => true });
const other = (patch: Partial<LockHolder> = {}): LockHolder => ({
  ...lockHolder('worker', 'live'),
  ...patch,
});

describe('the worker lock', () => {
  it('goes to the first worker; a second waits while the first is alive and renewing', () => {
    const dev = other();
    const cli = lockHolder('cli', 'live');
    expect(acquireWorkerLock(t.db, dev, at(0))).toEqual({ acquired: true, takenFrom: null });
    const refused = acquireWorkerLock(t.db, cli, at(1_000));
    expect(refused).toMatchObject({
      acquired: false,
      holder: { holder: dev.holder, kind: 'worker' },
    });
    expect(renewWorkerLock(t.db, dev, at(LOCK_STALE_MS))).toBe(true);
    expect(acquireWorkerLock(t.db, cli, at(LOCK_STALE_MS + 1_000)).acquired).toBe(false);
    // Its own lock again: kept.
    expect(acquireWorkerLock(t.db, dev, at(LOCK_STALE_MS + 2_000))).toEqual({
      acquired: true,
      takenFrom: null,
    });
  });

  it('is taken over when the holder’s heartbeat is stale or its process is gone; the old holder learns it on renewal', () => {
    const dev = other();
    const cli = lockHolder('cli', 'dry_run');
    acquireWorkerLock(t.db, dev, at(0));
    const taken = acquireWorkerLock(t.db, cli, at(LOCK_STALE_MS + 1));
    expect(taken).toMatchObject({ acquired: true, takenFrom: { holder: dev.holder } });
    expect(readWorkerLock(t.db)).toMatchObject({
      holder: cli.holder,
      kind: 'cli',
      llmMode: 'dry_run',
    });
    expect(renewWorkerLock(t.db, dev, at(LOCK_STALE_MS + 2))).toBe(false);

    // Same host, dead process: taken at once.
    const gone = other({ pid: 999_999 });
    releaseWorkerLock(t.db, cli);
    acquireWorkerLock(t.db, gone, at(0));
    const next = acquireWorkerLock(t.db, cli, {
      now: at(1).now,
      isAlive: (pid) => pid !== 999_999,
    });
    expect(next).toMatchObject({ acquired: true, takenFrom: { pid: 999_999 } });
  });

  it('a holder on another host is trusted until its heartbeat is stale', () => {
    const remote = other({ host: 'other-machine', pid: 1 });
    acquireWorkerLock(t.db, remote, at(0));
    const me = lockHolder('cli', 'live');
    expect(acquireWorkerLock(t.db, me, { now: at(1_000).now, isAlive: () => false }).acquired).toBe(
      false,
    );
  });

  it('is released by its holder only', () => {
    const dev = other();
    acquireWorkerLock(t.db, dev, at(0));
    releaseWorkerLock(t.db, lockHolder('cli', 'live'));
    expect(readWorkerLock(t.db)?.holder).toBe(dev.holder);
    releaseWorkerLock(t.db, dev);
    expect(readWorkerLock(t.db)).toBeUndefined();
  });
});
