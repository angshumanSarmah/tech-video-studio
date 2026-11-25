import { UsageSummarySchema } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordExport } from '#core/db/repositories/exports.ts';
import { createRun } from '#core/db/repositories/runs.ts';
import { listSeries } from '#core/db/repositories/series.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { TEST_APP_SETTINGS } from '#core/db/testing.ts';
import { createTestServer, expectApiError, type TestServer } from '../testing.ts';

let s: TestServer;

beforeEach(() => {
  s = createTestServer();
});

afterEach(() => s.cleanup());

function exportedVideo(title: string, hook: string): number {
  const run = createRun(s.db, {
    app: TEST_APP_SETTINGS,
    topicId: createTopic(s.db, { title }).id,
    seriesId: listSeries(s.db)[0]!.id,
  });
  recordExport(s.db, {
    runId: run.id,
    mp4Path: `exports/${run.id}/v.mp4`,
    srtPath: `exports/${run.id}/v.srt`,
    durationMs: 60_000,
    title,
    usage: [{ kind: 'hook', value: hook }],
  });
  return run.id;
}

describe('GET /api/memory/usage', () => {
  it('returns the last N videos, newest first, with counts per kind', async () => {
    exportedVideo('<a>', 'problem/x');
    const newest = exportedVideo('<b>', 'puzzle/y');
    const res = await s.app.request('/api/memory/usage?videos=1');
    expect(res.status).toBe(200);
    const summary = UsageSummarySchema.parse(await res.json());
    expect(summary.videos.map((v) => v.videoRunId)).toEqual([newest]);
    expect(summary.counts.hook).toEqual([{ value: 'puzzle/y', videos: 1 }]);
  });

  it('defaults to the last 10 and refuses a count out of range', async () => {
    const res = await s.app.request('/api/memory/usage');
    expect(UsageSummarySchema.parse(await res.json()).videos).toEqual([]);
    await expectApiError(await s.app.request('/api/memory/usage?videos=0'), 400, 'bad_request');
  });
});
