import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enqueueJob, getJob } from '#core/db/repositories/jobs.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { readWorkerLock } from '#core/services/worker-lock.ts';
import { testConfig } from '#core/config-testing.ts';
import { dryRunTransport } from './llm/dry-run.ts';
import { fakeTools } from './render/testing.ts';
import { fixtureTts } from './repair/testing.ts';
import { startWorker, type WorkerOptions } from './runtime.ts';

/** A noop job that ends at once. */
const QUICK = { steps: 1, stepMs: 0 };

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

const options = (kind: WorkerOptions['kind']): WorkerOptions => ({
  config: testConfig(t.dataDir),
  db: t.db,
  kind,
  log: () => undefined,
  parts: {
    tools: fakeTools().tools,
    tts: fixtureTts('tokenizer', join(t.dataDir, 'fake-tts')).provider,
    transport: dryRunTransport({}),
  },
  pollIntervalMs: 5,
  lockIntervalMs: 10,
});

async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('the worker runtime', () => {
  it('claims jobs only while it holds the lock; a standby worker takes over when the holder stops', async () => {
    const first = startWorker(options('worker'));
    const second = startWorker(options('cli'));
    expect([first.holdsLock(), second.holdsLock()]).toEqual([true, false]);

    const job = enqueueJob(t.db, { type: 'noop', payload: QUICK });
    await until(() => getJob(t.db, job.id)!.status === 'done');

    await first.stop();
    await until(() => second.holdsLock());
    expect(readWorkerLock(t.db)).toMatchObject({ holder: second.holder.holder, kind: 'cli' });
    const next = enqueueJob(t.db, { type: 'noop', payload: QUICK });
    await until(() => getJob(t.db, next.id)!.status === 'done');
    await second.stop();
    expect(readWorkerLock(t.db)).toBeUndefined();
  });
});
