import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { series } from '../schema.ts';
import { createTestDb, type TestDb } from '../testing.ts';
import { appendRunEvent, latestRunEventId, listRunEventsSince } from './run-events.ts';
import { createRun } from './runs.ts';
import { createTopic } from './topics.ts';

let t: TestDb;
let runA: number;
let runB: number;

beforeEach(() => {
  t = createTestDb();
  const topicId = createTopic(t.db, { title: 'Caching' }).id;
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'ai')).get()!.id;
  runA = createRun(t.db, { topicId, seriesId }).id;
  runB = createRun(t.db, { topicId, seriesId }).id;
});

afterEach(() => t.cleanup());

describe('run events', () => {
  it('reports 0 as the latest id when there are no events', () => {
    expect(latestRunEventId(t.db)).toBe(0);
  });

  it('lists events after a cursor, oldest first, for one run or all', () => {
    const a1 = appendRunEvent(t.db, { runId: runA, type: 'status', payload: { status: 'queued' } });
    const b1 = appendRunEvent(t.db, { runId: runB, type: 'log' });
    const a2 = appendRunEvent(t.db, { runId: runA, type: 'progress', payload: { pct: 50 } });

    const ids = (events: { id: number }[]) => events.map((e) => e.id);
    expect(ids(listRunEventsSince(t.db, { afterId: 0, limit: 10 }))).toEqual([a1.id, b1.id, a2.id]);
    expect(ids(listRunEventsSince(t.db, { runId: runA, afterId: 0, limit: 10 }))).toEqual([
      a1.id,
      a2.id,
    ]);
    expect(ids(listRunEventsSince(t.db, { runId: runA, afterId: a1.id, limit: 10 }))).toEqual([
      a2.id,
    ]);
    expect(ids(listRunEventsSince(t.db, { afterId: 0, limit: 2 }))).toEqual([a1.id, b1.id]);
    expect(latestRunEventId(t.db)).toBe(a2.id);
    expect(b1.payload).toEqual({});
  });
});
