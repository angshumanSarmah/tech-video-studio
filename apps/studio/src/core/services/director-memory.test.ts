import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordExport } from '../db/repositories/exports.ts';
import { createRun } from '../db/repositories/runs.ts';
import { listSeries } from '../db/repositories/series.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { memoryRules, usageHistory } from '../db/schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import { directorMemory, nextSeriesNumber, RECENT_VIDEOS } from './director-memory.ts';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

const seriesIds = () => listSeries(t.db).map((s) => s.id);

/** A run of a new topic in the first series, exported when `exported`. */
function video(title: string, options: { exported?: boolean; seriesId?: number } = {}) {
  const topic = createTopic(t.db, { title, notes: `<${title} notes>` });
  const run = createRun(t.db, {
    app: TEST_APP_SETTINGS,
    topicId: topic.id,
    seriesId: options.seriesId ?? seriesIds()[0]!,
  });
  if (options.exported ?? true) {
    recordExport(t.db, {
      runId: run.id,
      mp4Path: `exports/${run.id}/v.mp4`,
      srtPath: `exports/${run.id}/v.srt`,
      durationMs: 60_000,
      title,
    });
  }
  return run;
}

function used(runId: number, kind: 'device' | 'layout' | 'device_layout', value: string) {
  t.db.insert(usageHistory).values({ runId, kind, value }).run();
}

describe('directorMemory', () => {
  it('is empty without history', () => {
    const run = video('<current>', { exported: false });
    expect(directorMemory(t.db, run.id)).toEqual({
      styleRules: [],
      recent: { videos: 0, devices: [], layouts: [], patterns: [], combos: [] },
      pastTopics: [],
    });
  });

  it(`reads usage from the last ${RECENT_VIDEOS} exported videos only, sorted`, () => {
    const old = video('<oldest>');
    used(old.id, 'device_layout', 'roadmap/pipeline');
    const recent = Array.from({ length: RECENT_VIDEOS }, (_, i) => video(`<topic-${i}>`));
    used(recent[0]!.id, 'device', 'what_breaks');
    used(recent[4]!.id, 'device', 'failure_before_fix');
    used(recent[4]!.id, 'device_layout', 'failure_before_fix/versus_split');
    used(recent[2]!.id, 'layout', 'pipeline');
    video('<unexported>', { exported: false });
    const current = video('<current>', { exported: false });

    const memory = directorMemory(t.db, current.id);
    expect(memory.recent).toEqual({
      videos: RECENT_VIDEOS,
      devices: ['failure_before_fix', 'what_breaks'],
      layouts: ['pipeline'],
      patterns: [],
      combos: ['failure_before_fix/versus_split'],
    });
    expect(memory.pastTopics.map((p) => p.title)).toEqual([
      '<topic-4>',
      '<topic-3>',
      '<topic-2>',
      '<topic-1>',
      '<topic-0>',
      '<oldest>',
    ]);
    expect(memory.pastTopics[0]?.notes).toBe('<<topic-4> notes>');
  });

  it('includes only active rules scoped to the director or all agents', () => {
    const run = video('<current>', { exported: false });
    t.db
      .insert(memoryRules)
      .values([
        { scope: 'director', text: '<rule-director>', status: 'active' },
        { scope: 'generator', text: '<rule-generator>', status: 'active' },
        { scope: 'all', text: '<rule-all>', status: 'active' },
        { scope: 'director', text: '<rule-proposed>', status: 'proposed' },
      ])
      .run();
    expect(directorMemory(t.db, run.id).styleRules).toEqual(['<rule-director>', '<rule-all>']);
  });
});

describe('nextSeriesNumber', () => {
  it('counts exported videos in the series', () => {
    const [first, second] = seriesIds();
    expect(nextSeriesNumber(t.db, first!)).toBe(1);
    video('<a>');
    video('<b>');
    video('<c>', { exported: false });
    video('<d>', { seriesId: second! });
    expect(nextSeriesNumber(t.db, first!)).toBe(3);
    expect(nextSeriesNumber(t.db, second!)).toBe(2);
  });
});
