import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobs } from '../schema.ts';
import { createTestDb, type TestDb } from '../testing.ts';
import { claimNextJob, enqueueJob, getJob, releaseJob } from './jobs.ts';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

const NOW = new Date('2026-11-18T12:00:00Z');
const claim = (now = NOW) => claimNextJob(t.db, { workerId: 'host:1', now });

describe('claimNextJob', () => {
  it('claims the oldest due job, locks it and counts the attempt', () => {
    const first = enqueueJob(t.db, { type: 'noop' });
    enqueueJob(t.db, { type: 'noop' });
    t.db
      .update(jobs)
      .set({ runAfter: new Date(0) })
      .run();

    expect(claim()).toMatchObject({
      id: first.id,
      status: 'running',
      attempts: 1,
      lockedBy: 'host:1',
      lockedAt: NOW,
    });
  });

  it('never claims the same job twice and returns undefined when nothing is due', () => {
    enqueueJob(t.db, { type: 'noop' });
    const later = new Date(Date.now() + 60_000);
    expect(claim(later)).toBeDefined();
    expect(claim(later)).toBeUndefined();
  });

  it('honours run_after', () => {
    const job = enqueueJob(t.db, { type: 'noop' });
    t.db
      .update(jobs)
      .set({ runAfter: new Date(NOW.getTime() + 1) })
      .run();

    expect(claim()).toBeUndefined();
    expect(claim(new Date(NOW.getTime() + 1))?.id).toBe(job.id);
  });

  it('orders by run_after before id', () => {
    const a = enqueueJob(t.db, { type: 'noop' });
    const b = enqueueJob(t.db, { type: 'noop' });
    t.db
      .update(jobs)
      .set({ runAfter: new Date(0) })
      .run();
    t.db
      .update(jobs)
      .set({ runAfter: new Date(1) })
      .where(eq(jobs.id, a.id))
      .run();

    expect(claim()?.id).toBe(b.id);
  });
});

describe('releaseJob', () => {
  it('clears the lock and only applies to running jobs', () => {
    const job = enqueueJob(t.db, { type: 'noop' });
    expect(releaseJob(t.db, job.id, { status: 'done' })).toBeUndefined();

    claim(new Date(Date.now() + 60_000));
    expect(releaseJob(t.db, job.id, { status: 'failed', error: 'boom' })).toMatchObject({
      status: 'failed',
      error: 'boom',
      lockedAt: null,
      lockedBy: null,
      attempts: 1,
    });
  });

  it('refunds the attempt when asked', () => {
    const job = enqueueJob(t.db, { type: 'noop' });
    claim(new Date(Date.now() + 60_000));
    releaseJob(t.db, job.id, { status: 'queued', refundAttempt: true });
    expect(getJob(t.db, job.id)).toMatchObject({ status: 'queued', attempts: 0 });
  });
});
