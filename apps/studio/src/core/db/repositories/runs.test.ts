import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentHash, sourceTextPath } from '../../data-files.ts';
import { series, sources, topics } from '../schema.ts';
import { createTestDb, type TestDb } from '../testing.ts';
import { createRun, getRun, listRunSources, recordRunSources } from './runs.ts';

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
