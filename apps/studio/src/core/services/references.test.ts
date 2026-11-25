import { existsSync } from 'node:fs';
import type { ReferenceRecord } from '@explainer-studio/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDataPath } from '../data-files.ts';
import { listReferenceBacklog } from '../db/repositories/backlog.ts';
import { getJob } from '../db/repositories/jobs.ts';
import { jobs, missingPrimitiveRequests } from '../db/schema.ts';
import { createTestDb, type TestDb } from '../db/testing.ts';
import { ConflictError, InvalidEditError, InvalidSourceError } from '../errors.ts';
import { noSeedReferences, seedBreakdown, seedRecord } from './references-testing.ts';
import {
  addReference,
  backlogDescription,
  editReferenceRecord,
  firstHeading,
  reanalyzeReference,
  readReferenceBreakdown,
  requireReference,
  saveReferenceRecord,
  slugify,
} from './references.ts';

let t: TestDb;
beforeEach(() => {
  t = createTestDb(noSeedReferences());
});
afterEach(() => t.cleanup());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function add(breakdown = '# Reference: a pasted breakdown\n\nBeats go here.', title?: string) {
  return t.db.transaction((tx) =>
    addReference(tx, t.dataDir, { breakdown, ...(title ? { title } : {}) }),
  );
}

describe('addReference', () => {
  it('stores the breakdown and screenshots, then queues the analyst', () => {
    const { row, job } = t.db.transaction((tx) =>
      addReference(
        tx,
        t.dataDir,
        {
          breakdown: '# Reference: one queue, many workers\n\nBeats.',
          namesToAvoid: [{ text: 'Acme', kind: 'brand' }],
        },
        [{ name: 'frame 1.PNG', bytes: PNG }],
      ),
    );
    expect(row).toMatchObject({
      slug: 'one-queue-many-workers',
      origin: 'pasted',
      status: 'pending',
    });
    expect(readReferenceBreakdown(t.dataDir, row)).toContain('one queue, many workers');
    expect(row.attachments.map((a) => [a.name, a.bytes])).toEqual([
      ['frame 1.PNG', PNG.byteLength],
    ]);
    expect(row.attachments[0]!.path).toMatch(
      /^references\/one-queue-many-workers\/attachments\/\w+\.png$/,
    );
    expect(existsSync(resolveDataPath(t.dataDir, row.attachments[0]!.path))).toBe(true);
    expect(getJob(t.db, job.id)).toMatchObject({
      type: 'analyze_reference',
      runId: null,
      payload: { referenceId: row.id, namesToAvoid: [{ text: 'Acme', kind: 'brand' }] },
    });
  });

  it('gives every reference its own slug', () => {
    expect(add(undefined, 'Same title').row.slug).toBe('same-title');
    expect(add(undefined, 'Same title').row.slug).toBe('same-title-2');
    expect(add('no heading at all').row.slug).toBe('pasted-reference');
  });

  it('refuses screenshots it does not keep', () => {
    const attach = (name: string, bytes: Uint8Array) =>
      t.db.transaction((tx) => addReference(tx, t.dataDir, { breakdown: 'x' }, [{ name, bytes }]));
    expect(() => attach('notes.svg', PNG)).toThrow(InvalidSourceError);
    expect(() => attach('empty.png', new Uint8Array())).toThrow(/empty/);
  });
});

describe('records and the backlog', () => {
  function ready(record: ReferenceRecord = seedRecord('ride-hailing-demand-heatmap')) {
    const { row, job } = add(seedBreakdown('ride-hailing-demand-heatmap'));
    t.db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, job.id)).run();
    t.db.transaction((tx) => saveReferenceRecord(tx, t.dataDir, row, record));
    return requireReference(t.db, row.id);
  }

  it('links each buildable unmapped item to the reference, phase 2 marked', () => {
    const row = ready();
    expect(row).toMatchObject({ status: 'ready', topicClass: 'product-design' });
    const backlog = listReferenceBacklog(t.db, row.id);
    const record = seedRecord('ride-hailing-demand-heatmap');
    expect(backlog.map((b) => b.name)).toEqual(
      record.unmapped.filter((u) => u.buildable !== 'no').map((u) => u.name),
    );
    expect(backlog.every((b) => b.runId === null && b.status === 'open')).toBe(true);
    expect(backlog.find((b) => b.description.includes('(phase 2)'))).toBeDefined();
  });

  it('drops open rows that left the record and keeps decided ones', () => {
    const record = seedRecord('ride-hailing-demand-heatmap');
    const row = ready(record);
    const [first, second] = listReferenceBacklog(t.db, row.id);
    t.db
      .update(missingPrimitiveRequests)
      .set({ status: 'planned' })
      .where(eq(missingPrimitiveRequests.id, first!.id))
      .run();
    const fewer = { ...record, unmapped: [] };
    t.db.transaction((tx) => editReferenceRecord(tx, t.dataDir, row.id, fewer));
    expect(listReferenceBacklog(t.db, row.id).map((b) => [b.name, b.status])).toEqual([
      [first!.name, 'planned'],
    ]);
    expect(second).toBeDefined();
  });

  it('refuses an edit that fails the checks, with the issues', () => {
    const row = ready();
    const record = seedRecord('ride-hailing-demand-heatmap');
    const bad = { ...record, arc: 'Riders open Zippo for 5 minutes' };
    let caught: unknown;
    try {
      t.db.transaction((tx) => editReferenceRecord(tx, t.dataDir, row.id, bad));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidEditError);
    expect((caught as InvalidEditError).issues.map((i) => i.message.split(':')[0])).toEqual([
      'proper_noun',
      'digits_in_text',
    ]);
    const schemaBad = { ...record, topicClass: 'gaming' };
    expect(() =>
      t.db.transaction((tx) => editReferenceRecord(tx, t.dataDir, row.id, schemaBad)),
    ).toThrow(InvalidEditError);
  });

  it('analyses again with the record’s names, once at a time', () => {
    const row = ready({
      ...seedRecord('live-score-fanout'),
      namesToAvoid: [{ text: 'Scorely', kind: 'brand' }],
    });
    const job = t.db.transaction((tx) => reanalyzeReference(tx, t.dataDir, row.id));
    expect(requireReference(t.db, row.id).status).toBe('pending');
    expect(job.payload).toEqual({
      referenceId: row.id,
      namesToAvoid: [{ text: 'Scorely', kind: 'brand' }],
    });
    expect(() => t.db.transaction((tx) => reanalyzeReference(tx, t.dataDir, row.id))).toThrow(
      ConflictError,
    );
  });
});

describe('helpers', () => {
  it('names a slug and a title', () => {
    expect(slugify('Who gets the last seat? (v2)')).toBe('who-gets-the-last-seat-v2');
    expect(firstHeading('intro\n# Reference: one seat, many buyers\n')).toBe(
      'one seat, many buyers',
    );
  });

  it('describes a backlog row with its phase and closest id', () => {
    expect(
      backlogDescription({
        kind: 'primitive',
        name: 'hex_grid',
        description: 'A honeycomb grid.',
        closest: 'grid_overlay',
        buildable: 'phase_2',
      }),
    ).toBe('A honeycomb grid. (phase 2) (closest: grid_overlay)');
  });
});
