import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRunJobs } from '../db/repositories/jobs.ts';
import { listRunEventsSince } from '../db/repositories/run-events.ts';
import { listRuns } from '../db/repositories/runs.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { series } from '../db/schema.ts';
import { createTestDb, type TestDb } from '../db/testing.ts';
import { NotFoundError } from '../errors.ts';
import { FIRST_RUN_JOB_TYPE, startRun } from './runs.ts';

let t: TestDb;
let topicId: number;
let seriesId: number;

beforeEach(() => {
  t = createTestDb();
  topicId = createTopic(t.db, { title: 'Rate limiting' }).id;
  seriesId = t.db.select().from(series).where(eq(series.tag, 'ai')).get()!.id;
});

afterEach(() => t.cleanup());

describe('startRun', () => {
  it('creates the run, its first job and a status event', () => {
    const { run, job } = startRun(t.db, { topicId, seriesId, settings: { lengthOverrideSec: 60 } });

    expect(run).toMatchObject({ topicId, seriesId, status: 'queued' });
    expect(run.settings.lengthOverrideSec).toBe(60);
    expect(listRunJobs(t.db, run.id)).toEqual([job]);
    expect(job).toMatchObject({ type: FIRST_RUN_JOB_TYPE, status: 'queued', attempts: 0 });
    expect(listRunEventsSince(t.db, { runId: run.id, afterId: 0, limit: 10 })).toMatchObject([
      { runId: run.id, jobId: job.id, type: 'status', payload: { status: 'queued' } },
    ]);
  });

  it.each([
    ['Topic', () => ({ topicId: 999, seriesId })],
    ['Series', () => ({ topicId, seriesId: 999 })],
  ])('throws NotFoundError for an unknown %s and writes nothing', (entity, input) => {
    expect(() => startRun(t.db, input())).toThrow(new NotFoundError(entity, 999));
    expect(listRuns(t.db)).toEqual([]);
  });

  it('rolls back the run when enqueueing its job fails', () => {
    t.db.$client.exec(
      "create trigger jobs_fail before insert on jobs begin select raise(abort, 'enqueue failed'); end",
    );

    expect(() => startRun(t.db, { topicId, seriesId })).toThrow(/enqueue failed/);
    expect(listRuns(t.db)).toEqual([]);
  });
});
