import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { events, series } from '../schema.ts';
import { createTestDb, type TestDb } from '../testing.ts';
import { appendEvent, latestEventId, listEventsSince, type NewEvent } from './events.ts';
import { enqueueJob } from './jobs.ts';
import { createRun } from './runs.ts';
import { createTopic } from './topics.ts';

let t: TestDb;
let runA: number;
let runB: number;
let looseJob: number;

beforeEach(() => {
  t = createTestDb();
  const topicId = createTopic(t.db, { title: 'Caching' }).id;
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'ai')).get()!.id;
  runA = createRun(t.db, { topicId, seriesId }).id;
  runB = createRun(t.db, { topicId, seriesId }).id;
  looseJob = enqueueJob(t.db, { type: 'noop' }).id;
});

afterEach(() => t.cleanup());

const ids = (rows: { id: number }[]) => rows.map((e) => e.id);

describe('events', () => {
  it('reports 0 as the latest id when there are no events', () => {
    expect(latestEventId(t.db)).toBe(0);
    expect(latestEventId(t.db, { runId: runA })).toBe(0);
  });

  it('lists events after a cursor, oldest first, for one run, one job or all', () => {
    const a1 = appendEvent(t.db, {
      runId: runA,
      type: 'run_status',
      payload: { status: 'queued' },
    });
    const j1 = appendEvent(t.db, { jobId: looseJob, type: 'progress', payload: { pct: 20 } });
    const b1 = appendEvent(t.db, {
      runId: runB,
      type: 'log',
      payload: { level: 'info', message: 'hi' },
    });
    const a2 = appendEvent(t.db, { runId: runA, type: 'progress', payload: { pct: 50 } });

    expect(ids(listEventsSince(t.db, { afterId: 0, limit: 10 }))).toEqual([
      a1.id,
      j1.id,
      b1.id,
      a2.id,
    ]);
    expect(ids(listEventsSince(t.db, { runId: runA, afterId: 0, limit: 10 }))).toEqual([
      a1.id,
      a2.id,
    ]);
    expect(ids(listEventsSince(t.db, { runId: runA, afterId: a1.id, limit: 10 }))).toEqual([a2.id]);
    expect(ids(listEventsSince(t.db, { jobId: looseJob, afterId: 0, limit: 10 }))).toEqual([j1.id]);
    expect(ids(listEventsSince(t.db, { afterId: 0, limit: 2 }))).toEqual([a1.id, j1.id]);
    expect(latestEventId(t.db)).toBe(a2.id);
    expect(latestEventId(t.db, { runId: runB })).toBe(b1.id);
    expect(latestEventId(t.db, { jobId: looseJob })).toBe(j1.id);
  });

  it('stores events of a job without a run', () => {
    const event = appendEvent(t.db, {
      jobId: looseJob,
      type: 'job_status',
      payload: { status: 'running' },
    });
    expect(event).toMatchObject({ runId: null, jobId: looseJob, type: 'job_status' });
  });

  it('validates the payload against its type before writing', () => {
    const bad = [
      { runId: runA, type: 'progress', payload: { pct: 150 } },
      { runId: runA, type: 'progress', payload: { status: 'queued' } },
      { runId: runA, type: 'log', payload: { level: 'debug', message: 'x' } },
    ] as unknown as NewEvent[];
    for (const event of bad) expect(() => appendEvent(t.db, event)).toThrow();
    expect(latestEventId(t.db)).toBe(0);
  });

  it('requires a run or a job (DB check)', () => {
    expect(() =>
      t.db
        .insert(events)
        .values({ type: 'progress', payload: { pct: 1 } })
        .run(),
    ).toThrow(/CHECK constraint failed: events_owner_ck/);
  });
});
