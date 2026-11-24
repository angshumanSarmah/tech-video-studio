import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson } from '../data-files.ts';
import { createRun } from '../db/repositories/runs.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { series } from '../db/schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import { saveSpecVersion } from './spec-versions.ts';

let t: TestDb;
let runId: number;

beforeEach(() => {
  t = createTestDb();
  const topicId = createTopic(t.db, { title: 'Topic' }).id;
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'system-design')).get()!.id;
  runId = createRun(t.db, { app: TEST_APP_SETTINGS, topicId, seriesId }).id;
});

afterEach(() => t.cleanup());

describe('saveSpecVersion', () => {
  it('numbers versions per run and writes the JSON file', () => {
    const first = saveSpecVersion(t.db, t.dataDir, { runId, spec: { a: 1 }, createdBy: 'agent' });
    const second = saveSpecVersion(t.db, t.dataDir, {
      runId,
      spec: { a: 2 },
      createdBy: 'external',
      sourceLabel: 'chat import',
    });
    expect([first.version.version, second.version.version]).toEqual([1, 2]);
    expect(second.version.jsonPath).toBe(`runs/${runId}/specs/v2.json`);
    expect(second.version.sourceLabel).toBe('chat import');
    expect(readDataJson(t.dataDir, second.version.jsonPath)).toEqual({ a: 2 });
  });

  it('does not stack a version identical to the latest', () => {
    const first = saveSpecVersion(t.db, t.dataDir, { runId, spec: { a: 1 }, createdBy: 'agent' });
    const again = saveSpecVersion(t.db, t.dataDir, { runId, spec: { a: 1 }, createdBy: 'agent' });
    expect(again).toEqual({ version: first.version, created: false });
  });
});
