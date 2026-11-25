import type { UsageKind } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordExport } from '../db/repositories/exports.ts';
import { createRun, type Run } from '../db/repositories/runs.ts';
import { listSeries } from '../db/repositories/series.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import { usageSummary } from './usage-history.ts';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

function newRun(title: string, part?: { parentRunId: number; index: number; count: number }) {
  return createRun(t.db, {
    app: TEST_APP_SETTINGS,
    topicId: createTopic(t.db, { title }).id,
    seriesId: listSeries(t.db)[0]!.id,
    ...(part ? { part } : {}),
  });
}

function exportWith(r: Run, title: string, usage: [UsageKind, string][]): void {
  recordExport(t.db, {
    runId: r.id,
    mp4Path: `exports/${r.id}/v.mp4`,
    srtPath: `exports/${r.id}/v.srt`,
    durationMs: 60_000,
    title,
    usage: usage.map(([kind, value]) => ({ kind, value })),
  });
}

describe('usageSummary', () => {
  it('lists the last videos newest first, a multi-part video once, with counts per kind', () => {
    const single = newRun('<single>');
    exportWith(single, '<single>', [
      ['hook', 'problem/a'],
      ['ending', 'spec_card_ending'],
      ['pattern', 'p1'],
    ]);
    const parent = newRun('<parts>');
    const one = newRun('<parts>', { parentRunId: parent.id, index: 1, count: 2 });
    const two = newRun('<parts>', { parentRunId: parent.id, index: 2, count: 2 });
    exportWith(one, '<parts> 1', [
      ['hook', 'puzzle/b'],
      ['ending', 'cliffhanger_ending'],
      ['pattern', 'p1'],
      ['pattern_sequence', 'p1>p2'],
    ]);
    exportWith(two, '<parts> 2', [
      ['hook', 'problem/a'],
      ['ending', 'spec_card_ending'],
      ['pattern', 'p1'],
    ]);

    const summary = usageSummary(t.db, 10);
    expect(summary.videos).toMatchObject([
      {
        videoRunId: parent.id,
        runIds: [one.id, two.id],
        title: '<parts> 2',
        hooks: ['puzzle/b', 'problem/a'],
        endings: ['cliffhanger_ending', 'spec_card_ending'],
        sequences: ['p1>p2'],
      },
      { videoRunId: single.id, runIds: [single.id], hooks: ['problem/a'], sequences: [] },
    ]);
    // A value counts once per video, however many of its parts used it.
    expect(summary.counts.pattern).toEqual([{ value: 'p1', videos: 2 }]);
    expect(summary.counts.hook).toEqual([
      { value: 'problem/a', videos: 2 },
      { value: 'puzzle/b', videos: 1 },
    ]);
    expect(summary.counts.metaphor_world).toEqual([]);

    expect(usageSummary(t.db, 1).videos.map((v) => v.videoRunId)).toEqual([parent.id]);
  });
});
