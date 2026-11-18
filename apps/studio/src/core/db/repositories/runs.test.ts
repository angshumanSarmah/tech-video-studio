import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentHash, sourceTextPath } from '../../data-files.ts';
import { exports, series, sources, specVersions, topics, usageHistory } from '../schema.ts';
import { createTestDb, type TestDb } from '../testing.ts';
import {
  createRun,
  deleteRun,
  getRun,
  listRunSources,
  recordRunSources,
  RunHasExportsError,
} from './runs.ts';

let t: TestDb;
let topicId: number;
let seriesId: number;

beforeEach(() => {
  t = createTestDb();
  topicId = t.db.insert(topics).values({ title: 'Consistent hashing' }).returning().get().id;
  seriesId = t.db.select().from(series).where(eq(series.tag, 'system-design')).get()!.id;
});

afterEach(() => t.cleanup());

describe('runs repository', () => {
  it('inserts a run with default settings and reads it back', () => {
    const created = createRun(t.db, { topicId, seriesId });
    const read = getRun(t.db, created.id);

    expect(read).toEqual(created);
    expect(read).toMatchObject({
      topicId,
      seriesId,
      status: 'queued',
      currentStage: null,
      settings: {
        autoApprove: { research: false, beat_sheet: false, scenes: false, draft: false },
      },
    });
    expect(read?.createdAt).toBeInstanceOf(Date);
  });

  it('round-trips auto-approve and length override', () => {
    const { id } = createRun(t.db, {
      topicId,
      seriesId,
      settings: { autoApprove: { research: true }, lengthOverrideSec: 75 },
    });

    expect(getRun(t.db, id)?.settings).toEqual({
      autoApprove: { research: true, beat_sheet: false, scenes: false, draft: false },
      lengthOverrideSec: 75,
    });
  });

  it('returns undefined for an unknown id', () => {
    expect(getRun(t.db, 999)).toBeUndefined();
  });

  it('rejects invalid settings before writing', () => {
    expect(() =>
      createRun(t.db, { topicId, seriesId, settings: { lengthOverrideSec: 10 } }),
    ).toThrow();
  });

  it('enforces foreign keys', () => {
    expect(() => createRun(t.db, { topicId: 999, seriesId })).toThrow(/FOREIGN KEY/);
  });
});

describe('recordRunSources', () => {
  function addExtractedSource(url: string, text: string): number {
    const source = t.db.insert(sources).values({ topicId, kind: 'url', url }).returning().get();
    setSourceText(source.id, text);
    return source.id;
  }

  function setSourceText(sourceId: number, text: string): void {
    const hash = contentHash(text);
    t.db
      .update(sources)
      .set({
        status: 'extracted',
        contentHash: hash,
        textPath: sourceTextPath(topicId, sourceId, hash),
      })
      .where(eq(sources.id, sourceId))
      .run();
  }

  it('pins extracted source versions and keeps them after a re-fetch', () => {
    const a = addExtractedSource('https://example.com/a', 'version one');
    t.db.insert(sources).values({ topicId, kind: 'url', url: 'https://example.com/pending' }).run();
    const run = createRun(t.db, { topicId, seriesId });

    expect(recordRunSources(t.db, run.id)).toEqual([
      { sourceId: a, contentHash: contentHash('version one') },
    ]);

    setSourceText(a, 'version two');
    recordRunSources(t.db, run.id);

    expect(listRunSources(t.db, run.id)).toEqual([
      { sourceId: a, contentHash: contentHash('version one') },
    ]);
  });

  it('throws for an unknown run', () => {
    expect(() => recordRunSources(t.db, 999)).toThrow(/Run 999 not found/);
  });
});

describe('deleteRun', () => {
  function addUsage(runId: number): void {
    t.db.insert(usageHistory).values({ runId, kind: 'device', value: 'cold-open' }).run();
  }

  function addExport(runId: number): void {
    t.db
      .insert(exports)
      .values({
        runId,
        mp4Path: 'exports/a.mp4',
        srtPath: 'exports/a.srt',
        durationMs: 60_000,
        costUsd: 0.2,
      })
      .run();
  }

  function usageRows(runId: number): number {
    return t.db.select().from(usageHistory).where(eq(usageHistory.runId, runId)).all().length;
  }

  it('deletes a run that never exported and cascades its usage history', () => {
    const run = createRun(t.db, { topicId, seriesId });
    addUsage(run.id);

    expect(deleteRun(t.db, run.id)).toBe(true);
    expect(getRun(t.db, run.id)).toBeUndefined();
    expect(usageRows(run.id)).toBe(0);
  });

  it('refuses to delete an exported run and keeps its usage history', () => {
    const run = createRun(t.db, { topicId, seriesId });
    addUsage(run.id);
    addExport(run.id);

    expect(() => deleteRun(t.db, run.id)).toThrow(RunHasExportsError);
    expect(getRun(t.db, run.id)).toBeDefined();
    expect(usageRows(run.id)).toBe(1);
  });

  it('is enforced by the database for direct deletes too', () => {
    const run = createRun(t.db, { topicId, seriesId });
    addExport(run.id);

    expect(() => t.db.$client.prepare('delete from runs where id = ?').run(run.id)).toThrow(
      /FOREIGN KEY/,
    );
  });

  it('returns false for an unknown id', () => {
    expect(deleteRun(t.db, 999)).toBe(false);
  });
});

describe('spec_versions source label', () => {
  function insertSpec(createdBy: 'agent' | 'external', sourceLabel: string | null): void {
    const run = createRun(t.db, { topicId, seriesId });
    t.db
      .insert(specVersions)
      .values({ runId: run.id, version: 1, jsonPath: 'runs/1/spec.json', createdBy, sourceLabel })
      .run();
  }

  it('accepts an external spec with a label and an agent spec without one', () => {
    expect(() => insertSpec('external', 'chatgpt')).not.toThrow();
    expect(() => insertSpec('agent', null)).not.toThrow();
  });

  it.each([
    ['external', null],
    ['agent', 'chatgpt'],
  ] as const)('rejects created_by=%s with source_label=%s', (createdBy, label) => {
    expect(() => insertSpec(createdBy, label)).toThrow(/CHECK constraint/);
  });
});
