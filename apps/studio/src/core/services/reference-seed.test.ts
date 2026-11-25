import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backlogItems } from '@explainer-studio/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { listReferenceBacklog } from '../db/repositories/backlog.ts';
import { createTestDb, type TestDb } from '../db/testing.ts';
import { SEED_SLUGS, seedBreakdown, seedRecord } from './references-testing.ts';
import { defaultSeedReferencesDir, NAMES_TO_AVOID_FILE, seedReferences } from './reference-seed.ts';
import {
  checkReferenceRecord,
  editReferenceRecord,
  listReferences,
  readReferenceRecord,
  referenceCheckContext,
  requireReference,
} from './references.ts';

let t: TestDb | undefined;
afterEach(() => t?.cleanup());

/** A copy of the committed seeds that a test may change. */
function seedCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'seed-references-'));
  cpSync(defaultSeedReferencesDir(), dir, { recursive: true });
  return dir;
}

describe('seedReferences', () => {
  it('gives six ready records from the committed files', () => {
    t = createTestDb();
    const rows = listReferences(t.db);
    expect(rows.map((r) => [r.slug, r.origin, r.status, r.error])).toEqual(
      SEED_SLUGS.map((slug) => [slug, 'seed', 'ready', null]),
    );
    for (const row of rows) {
      const record = readReferenceRecord(t.dataDir, row);
      expect(record).not.toBeNull();
      const checked = checkReferenceRecord(
        record,
        referenceCheckContext({ breakdown: seedBreakdown(row.slug) }),
      );
      expect(checked).toHaveProperty('record');
      expect(row.title).toBe(record!.title);
      expect(row.topicClass).toBe(record!.topicClass);
      expect(listReferenceBacklog(t.db, row.id).map((b) => b.name)).toEqual(
        backlogItems(seedRecord(row.slug)).map((i) => i.name),
      );
    }
  });

  it('writes nothing again while the files are unchanged', () => {
    t = createTestDb();
    expect(seedReferences(t.db, t.dataDir)).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 6,
      failed: [],
      openSlots: [
        {
          slug: 'database-failover-split-brain',
          todo: "The incident's organisation: put its name in text.",
        },
      ],
    });
  });

  it('saves no beat device as a whole-video device', () => {
    t = createTestDb();
    const videoDevices = (slug: string) =>
      readReferenceRecord(t!.dataDir, requireReference(t!.db, slug))?.videoDevices;
    // The analyst listed these on beats and as whole-video devices too: the beats keep them.
    expect(seedRecord('database-failover-split-brain').videoDevices).toEqual(['planted_question']);
    expect(videoDevices('database-failover-split-brain')).toEqual([]);
    expect(videoDevices('food-delivery-eta')).toEqual([]);
    expect(videoDevices('live-score-fanout')).toEqual([]);
    expect(videoDevices('quick-commerce-dark-store')).toEqual(['hero_metric', 'question_chapters']);
    expect(videoDevices('seat-booking-contention')).toEqual(['roadmap']);
  });

  it('merges each seed’s names from the committed file, slots left out', () => {
    t = createTestDb();
    const names = (slug: string) =>
      readReferenceRecord(t!.dataDir, requireReference(t!.db, slug))
        ?.namesToAvoid.filter((n) => n.kind === 'brand')
        .map((n) => n.text);
    expect(names('ride-hailing-demand-heatmap')).toEqual(['Uber', 'DevMonk']);
    expect(names('live-score-fanout')).toEqual(['Cricbuzz', 'DevMonk']);
    expect(names('seat-booking-contention')).toEqual(['BookMyShow', 'DevMonk']);
    expect(names('quick-commerce-dark-store')).toEqual(['Flipkart Minutes', 'DevMonk']);
    expect(names('food-delivery-eta')).toEqual(['Zomato', 'DevMonk']);
    expect(names('database-failover-split-brain')).toEqual(['DevMonk']);
  });

  it('saves a seed again once its slot is filled', () => {
    const dir = seedCopy();
    t = createTestDb({ seedReferencesDir: dir });
    const file = JSON.parse(readFileSync(join(dir, NAMES_TO_AVOID_FILE), 'utf8')) as Record<
      string,
      { text: string }[]
    >;
    file['database-failover-split-brain']![1]!.text = 'Northwind Health';
    writeFileSync(join(dir, NAMES_TO_AVOID_FILE), JSON.stringify(file));
    const result = seedReferences(t.db, t.dataDir, dir);
    expect([result.updated, result.openSlots]).toEqual([1, []]);
    const row = requireReference(t.db, 'database-failover-split-brain');
    expect(readReferenceRecord(t.dataDir, row)?.namesToAvoid).toContainEqual({
      text: 'Northwind Health',
      kind: 'brand',
    });
  });

  it('keeps an edit made through the API until the committed files change', () => {
    const dir = seedCopy();
    t = createTestDb({ seedReferencesDir: dir });
    const row = requireReference(t.db, 'live-score-fanout');
    const edited = { ...seedRecord(row.slug), title: 'A score pushed to a crowd of phones' };
    t.db.transaction((tx) => editReferenceRecord(tx, t!.dataDir, row.id, edited));
    seedReferences(t.db, t.dataDir, dir);
    expect(readReferenceRecord(t.dataDir, requireReference(t.db, row.slug))?.title).toBe(
      edited.title,
    );

    const names = JSON.parse(readFileSync(join(dir, NAMES_TO_AVOID_FILE), 'utf8')) as Record<
      string,
      unknown[]
    >;
    names['live-score-fanout']!.push({ text: 'Scorely', kind: 'brand' });
    writeFileSync(join(dir, NAMES_TO_AVOID_FILE), JSON.stringify(names));
    expect(seedReferences(t.db, t.dataDir, dir).updated).toBe(1);
    const reseeded = readReferenceRecord(t.dataDir, requireReference(t.db, row.slug));
    expect(reseeded?.title).toBe(seedRecord(row.slug).title);
    expect(reseeded?.namesToAvoid.map((n) => n.text)).toContain('Scorely');
  });

  it('stores a record that fails its checks as failed and goes on', () => {
    const dir = seedCopy();
    const record = seedRecord('food-delivery-eta');
    const stale = {
      ...record,
      beats: [{ ...record.beats[0]!, patterns: ['retired_pattern'] }, ...record.beats.slice(1)],
    };
    writeFileSync(join(dir, 'food-delivery-eta.record.json'), JSON.stringify(stale));
    writeFileSync(join(dir, 'brand-new.md'), '# Reference: an uncommitted record\n');
    t = createTestDb({ seedReferencesDir: dir });
    const failed = listReferences(t.db).filter((r) => r.status === 'failed');
    expect(failed.map((r) => r.slug)).toEqual(['brand-new', 'food-delivery-eta']);
    expect(failed[0]!.error).toMatch(/run reference:fixture --record/);
    expect(failed[1]!.error).toMatch(/retired_pattern/);
    expect(listReferences(t.db).filter((r) => r.status === 'ready')).toHaveLength(5);
  });

  it('checks a record against the names file too', () => {
    const dir = seedCopy();
    writeFileSync(
      join(dir, NAMES_TO_AVOID_FILE),
      JSON.stringify({ 'database-failover-split-brain': [{ text: 'leader', kind: 'example' }] }),
    );
    t = createTestDb({ seedReferencesDir: dir });
    const row = requireReference(t.db, 'database-failover-split-brain');
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/name_in_structure: "leader" is in namesToAvoid/);
  });
});
