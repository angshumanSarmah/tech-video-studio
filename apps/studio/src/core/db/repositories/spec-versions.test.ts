import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channels, series, topics } from '../schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../testing.ts';
import { getRunRenderContext } from './run-render.ts';
import { createRun } from './runs.ts';
import { createSpecVersion, getLatestSpecVersion } from './spec-versions.ts';

let t: TestDb;
let runId: number;

beforeEach(() => {
  t = createTestDb();
  const topicId = t.db.insert(topics).values({ title: 'Rate limiters' }).returning().get().id;
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'system-design')).get()!.id;
  runId = createRun(t.db, { app: TEST_APP_SETTINGS, topicId, seriesId }).id;
});

afterEach(() => t.cleanup());

describe('spec versions', () => {
  it('returns the newest version of the run, or undefined before the first', () => {
    expect(getLatestSpecVersion(t.db, runId)).toBeUndefined();
    for (const version of [1, 3, 2]) {
      createSpecVersion(t.db, {
        runId,
        version,
        jsonPath: `runs/${runId}/specs/v${version}.json`,
        createdBy: 'agent',
      });
    }
    expect(getLatestSpecVersion(t.db, runId)).toMatchObject({ version: 3, sourceLabel: null });
  });
});

describe('getRunRenderContext', () => {
  it('joins the topic title, series label and accent, and channel handle', () => {
    t.db.update(channels).set({ handle: '@example' }).run();
    expect(getRunRenderContext(t.db, runId)).toEqual({
      runId,
      topicTitle: 'Rate limiters',
      series: { label: 'SYSTEM DESIGN', accentColour: '#4F8CFF' },
      channelHandle: '@example',
    });
  });

  it('returns undefined for an unknown run', () => {
    expect(getRunRenderContext(t.db, 999)).toBeUndefined();
  });
});
