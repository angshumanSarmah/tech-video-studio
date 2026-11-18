import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_SUBDIRS } from '../data-dirs.ts';
import { closeDatabase, openDatabase, type Db } from './client.ts';
import { prepareDatabase } from './prepare.ts';
import { channels, series } from './schema.ts';
import { DEFAULT_SERIES } from './seed.ts';
import { TEST_MIGRATIONS_DIR } from './testing.ts';

const EXPECTED_TABLES = [
  'assets',
  'channels',
  'exports',
  'gates',
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
    db = openDatabase(result.dbPath);
    expect(db.select().from(series).all()).toHaveLength(DEFAULT_SERIES.length);
  });

  it('opens connections with foreign keys enforced and WAL enabled', () => {
    db = openDatabase(join(dataDir, 'studio.db'));
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});
