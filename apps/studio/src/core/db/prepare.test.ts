import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_SUBDIRS } from '../data-dirs.ts';
import { closeDatabase, openDatabase, type Db } from './client.ts';
import { prepareDatabase } from './prepare.ts';
import { createSource } from './repositories/sources.ts';
import { createTopic } from './repositories/topics.ts';
import { channels, runSources, series, sources } from './schema.ts';
import { DEFAULT_SERIES } from './seed.ts';
import { noSeedReferences } from '../services/references-testing.ts';
import { TEST_MIGRATIONS_DIR } from './testing.ts';

const EXPECTED_TABLES = [
  'assets',
  'channels',
  'events',
  'exports',
  'gates',
  'jobs',
  'llm_calls',
  'memory_rules',
  'missing_primitive_requests',
  'reference_videos',
  'run_sources',
  'run_steps',
  'runs',
  'series',
  'sources',
  'spec_versions',
  'topics',
  'usage_history',
  'worker_lock',
];

function tableNames(db: Db): string[] {
  return db.$client
    .prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
    )
    .pluck()
    .all() as string[];
}

describe('prepareDatabase on a fresh data dir', () => {
  const dataDir = join(mkdtempSync(join(tmpdir(), 'studio-prepare-')), 'data');
  let db: Db | undefined;

  afterEach(() => {
    if (db) closeDatabase(db);
    db = undefined;
  });

  it('creates the data layout, applies the migration and seeds defaults', () => {
    const result = prepareDatabase(dataDir, TEST_MIGRATIONS_DIR);

    expect(result.seeded).toBe(true);
    expect(result.assets.inserted).toBeGreaterThan(0);
    expect(existsSync(join(dataDir, 'assets', 'server.svg'))).toBe(true);
    for (const sub of DATA_SUBDIRS) expect(existsSync(join(dataDir, sub))).toBe(true);

    db = openDatabase(result.dbPath);
    expect(tableNames(db)).toEqual(EXPECTED_TABLES);
    expect(db.select().from(channels).all()).toHaveLength(1);
    expect(
      db
        .select({ name: series.name, tag: series.tag, label: series.label })
        .from(series)
        .orderBy(series.id)
        .all(),
    ).toEqual([
      { name: 'System Design', tag: 'system-design', label: 'SYSTEM DESIGN' },
      { name: 'AI', tag: 'ai', label: 'AI' },
    ]);
  });

  it('is idempotent and does not re-seed', () => {
    const result = prepareDatabase(dataDir, TEST_MIGRATIONS_DIR);

    expect(result.seeded).toBe(false);
    expect(result.assets).toMatchObject({ inserted: 0, updated: 0 });
    db = openDatabase(result.dbPath);
    expect(db.select().from(series).all()).toHaveLength(DEFAULT_SERIES.length);
  });

  it('opens connections with foreign keys enforced and WAL enabled', () => {
    db = openDatabase(join(dataDir, 'studio.db'));
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});

describe('migrations on a database with data', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-migrate-'));
  let db: Db | undefined;

  afterEach(() => {
    if (db) closeDatabase(db);
    db = undefined;
  });

  /** The migrations folder as it stood after its first `count` migrations. */
  function migrationsUpTo(count: number): string {
    const dir = join(root, `migrations-${count}`);
    cpSync(TEST_MIGRATIONS_DIR, dir, { recursive: true });
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    writeFileSync(
      journalPath,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, count) }),
    );
    return dir;
  }

  it('rebuilds `sources` (0004) under a pinned source, keeping its rows and references', () => {
    const dataDir = join(root, 'data');
    // Seed references need the newest schema, so none are seeded on the old one.
    const { dbPath } = prepareDatabase(dataDir, migrationsUpTo(4), noSeedReferences());
    db = openDatabase(dbPath);
    const topic = createTopic(db, { title: 'Write-ahead logs' });
    const source = createSource(db, {
      topicId: topic.id,
      kind: 'url',
      url: 'https://example.com/a',
    });
    const seriesId = db.select().from(series).all()[0]!.id;
    // The runs table as it stood then (later migrations add columns), so plain SQL.
    const runId = db.$client
      .prepare(
        "insert into runs (topic_id, series_id, settings, resolved_settings) values (?, ?, '{}', '{}')",
      )
      .run(topic.id, seriesId).lastInsertRowid;
    db.$client
      .prepare('insert into run_sources (run_id, source_id, content_hash) values (?, ?, ?)')
      .run(runId, source.id, 'a'.repeat(64));
    closeDatabase(db);

    prepareDatabase(dataDir, TEST_MIGRATIONS_DIR);

    db = openDatabase(dbPath);
    expect(db.select().from(sources).all()).toMatchObject([{ id: source.id, kind: 'url' }]);
    expect(db.select().from(runSources).all()).toHaveLength(1);
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() => db!.delete(sources).run()).toThrow(/FOREIGN KEY/);
    const pasted = createSource(db, {
      topicId: topic.id,
      kind: 'text',
      filePath: 'topics/1/uploads/abc/pasted.txt',
      title: 'My notes',
    });
    expect(pasted).toMatchObject({ kind: 'text', title: 'My notes', url: null });
  });
});
