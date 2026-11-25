import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordExport } from '../db/repositories/exports.ts';
import { createRun, setActiveRunStatus, type Run } from '../db/repositories/runs.ts';
import { listSeries } from '../db/repositories/series.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import { similarTopics } from './topic-history.ts';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

function run(title: string, notes?: string): Run {
  const topic = createTopic(t.db, { title, ...(notes ? { notes } : {}) });
  return createRun(t.db, {
    app: TEST_APP_SETTINGS,
    topicId: topic.id,
    seriesId: listSeries(t.db)[0]!.id,
  });
}

function exported(r: Run): Run {
  recordExport(t.db, {
    runId: r.id,
    mp4Path: `exports/${r.id}/v.mp4`,
    srtPath: `exports/${r.id}/v.srt`,
    durationMs: 60_000,
    title: 'T',
    usage: [{ kind: 'topic_class', value: 'concept' }],
  });
  setActiveRunStatus(t.db, r.id, 'done');
  return r;
}

describe('similarTopics', () => {
  it('finds exported and in-progress topics close to the run’s, closest first', () => {
    const done = exported(run('Rate limiter', 'fail open or closed'));
    const busy = run('Rate limiting at the edge');
    run('Load balancer');
    const current = run('Rate limiting');
    expect(similarTopics(t.db, current.id)).toMatchObject([
      { title: 'Rate limiter', angle: 'fail open or closed', runId: done.id, score: 1 },
      { title: 'Rate limiting at the edge', runId: busy.id, exportedAt: null },
    ]);
    expect(similarTopics(t.db, current.id)[0]?.exportedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('leaves out finished runs that never exported, and the run’s own topic', () => {
    const failed = run('Rate limiter');
    setActiveRunStatus(t.db, failed.id, 'failed');
    const current = run('Rate limiter');
    expect(similarTopics(t.db, current.id)).toEqual([]);
  });

  it('leaves out its own parts', () => {
    const parent = run('Consistent hashing');
    const part = createRun(t.db, {
      app: TEST_APP_SETTINGS,
      topicId: createTopic(t.db, { title: 'Consistent hashing, part 2' }).id,
      seriesId: parent.seriesId,
      part: { parentRunId: parent.id, index: 2, count: 2 },
    });
    exported(part);
    expect(similarTopics(t.db, parent.id)).toEqual([]);
  });
});
