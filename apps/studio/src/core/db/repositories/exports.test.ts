import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { llmCalls, series } from '../schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../testing.ts';
import { listRunExports, recordExport } from './exports.ts';
import { createRun } from './runs.ts';
import { createTopic } from './topics.ts';

let t: TestDb;
let runId: number;

beforeEach(() => {
  t = createTestDb();
  const topicId = createTopic(t.db, { title: 'Rate limiters' }).id;
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'system-design')).get()!.id;
  runId = createRun(t.db, { app: TEST_APP_SETTINGS, topicId, seriesId }).id;
});

afterEach(() => t.cleanup());

function addCall(forRun: number | null, costUsd: number): void {
  t.db
    .insert(llmCalls)
    .values({
      runId: forRun,
      role: 'director',
      promptVersion: 'director@v1',
      model: 'model',
      costUsd,
      promptPath: 'prompt.txt',
    })
    .run();
}

const input = (mp4Path = 'exports/1/a.mp4') => ({
  runId,
  mp4Path,
  srtPath: mp4Path.replace(/mp4$/, 'srt'),
  durationMs: 61_000,
  title: 'How a rate limiter works',
});

describe('recordExport', () => {
  it('inserts a row with the run cost at that moment', () => {
    addCall(runId, 0.4);
    const row = recordExport(t.db, input());
    expect(row).toMatchObject({ ...input(), costUsd: 0.4 });
    expect(listRunExports(t.db, runId)).toEqual([row]);
  });

  it('refreshes the row for the same video path instead of adding one', () => {
    const first = recordExport(t.db, input());
    addCall(runId, 0.1);
    const second = recordExport(t.db, { ...input(), durationMs: 62_000 });
    expect(second.id).toBe(first.id);
    expect(listRunExports(t.db, runId)).toEqual([
      expect.objectContaining({ durationMs: 62_000, costUsd: 0.1 }),
    ]);
  });

  it('keeps one row per video path', () => {
    recordExport(t.db, input('exports/1/a.mp4'));
    recordExport(t.db, input('exports/1/b.mp4'));
    expect(listRunExports(t.db, runId).map((r) => r.mp4Path)).toEqual([
      'exports/1/a.mp4',
      'exports/1/b.mp4',
    ]);
  });
});
