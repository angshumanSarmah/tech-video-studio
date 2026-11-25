import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ResearchNotesSchema,
  type DirectorMemory,
  type ResearchNotes,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordExport } from '../db/repositories/exports.ts';
import { createRun } from '../db/repositories/runs.ts';
import { listSeries } from '../db/repositories/series.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { usageHistory } from '../db/schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import { findWorkspaceRoot } from '../workspace-root.ts';
import { directorMemory } from './director-memory.ts';
import {
  directorReferences,
  referenceNamesToAvoid,
  referenceUsage,
  scoreReferences,
} from './reference-retrieval.ts';
import { editReferenceRecord, requireReference } from './references.ts';
import { SEED_SLUGS, seedNames, seedRecord } from './references-testing.ts';

/**
 * P1C.11's retrieval acceptance: the two fixture topics, with their recorded research notes,
 * against the six seeds. The picks are pinned: a change to the seeds or the scoring shows here.
 */

const root = findWorkspaceRoot(import.meta.dirname);

/** A fixture topic's recorded notes: the Researcher's last (passing) answer. */
function fixtureNotes(topic: 'rate-limiter' | 'tokenizer'): ResearchNotes {
  const path = join(
    root,
    `apps/studio/src/worker/agents/researcher/fixtures/${topic}/responses/researcher.json`,
  );
  const answers = JSON.parse(readFileSync(path, 'utf8')) as { content: string }[];
  return ResearchNotesSchema.parse(JSON.parse(answers.at(-1)!.content));
}

const TOPICS = {
  'rate-limiter': { title: 'Rate limiters', series: 'system-design' },
  tokenizer: { title: 'How an LLM tokenizer works', series: 'ai' },
} as const;

let t: TestDb;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.cleanup());

const noMemory: DirectorMemory = {
  styleRules: [],
  recent: { videos: 0, devices: [], layouts: [], patterns: [], combos: [] },
  pastTopics: [],
};

function pick(topic: keyof typeof TOPICS, memory = noMemory) {
  return scoreReferences(t.db, t.dataDir, {
    topicTitle: TOPICS[topic].title,
    seriesTag: TOPICS[topic].series,
    notes: fixtureNotes(topic),
    memory,
  });
}

describe('retrieval for the fixture topics', () => {
  it('rate limiter (concept, an incident in the notes): the incident study first', () => {
    const result = pick('rate-limiter');
    expect(result.expected).toEqual({ topicClass: 'concept', from: 'title' });
    // Three tie at 3.0: the two sharing more of the concept class's preferred devices win.
    expect(result.picks.map((p) => [p.slug, p.score])).toEqual([
      ['database-failover-split-brain', 6.5],
      ['live-score-fanout', 3],
      ['ride-hailing-demand-heatmap', 3],
    ]);
    expect(result.picks[0]!.reasons).toEqual([
      'secondary class concept +1.5',
      'devices failure_before_fix, real_incident, what_breaks, contrast_takeaway +4',
      'series system-design +1',
    ]);
  });

  it('tokenizer (ai-ml): the reference with a model step first', () => {
    const result = pick('tokenizer');
    expect(result.expected).toEqual({ topicClass: 'ai-ml', from: 'title' });
    expect(result.picks.map((p) => [p.slug, p.score])).toEqual([
      ['food-delivery-eta', 4.5],
      ['database-failover-split-brain', 3],
      ['quick-commerce-dark-store', 3],
    ]);
    expect(result.picks[0]!.reasons).toContain('secondary class ai-ml +1.5');
    // The live score scores 4 but opens on the same persona hook as the pick above it.
    const live = result.scored.find((s) => s.slug === 'live-score-fanout')!;
    expect(live.score).toBe(4);
  });

  it('rotates: a reference the last videos were shown drops out', () => {
    const [series] = listSeries(t.db);
    for (const title of ['<past-a>', '<past-b>']) {
      const run = createRun(t.db, {
        app: TEST_APP_SETTINGS,
        topicId: createTopic(t.db, { title }).id,
        seriesId: series!.id,
      });
      recordExport(t.db, {
        runId: run.id,
        mp4Path: `${run.id}.mp4`,
        srtPath: `${run.id}.srt`,
        durationMs: 1,
        title,
        usage: [{ kind: 'reference', value: 'ride-hailing-demand-heatmap' }],
      });
    }
    const current = createRun(t.db, {
      app: TEST_APP_SETTINGS,
      topicId: createTopic(t.db, { title: 'Rate limiters' }).id,
      seriesId: series!.id,
    });
    const memory = directorMemory(t.db, current.id);
    expect(memory.recent.referencesShown).toEqual({ 'ride-hailing-demand-heatmap': 2 });
    const result = pick('rate-limiter', memory);
    expect(result.picks.map((p) => p.slug)).not.toContain('ride-hailing-demand-heatmap');
    expect(result.scored.find((s) => s.slug === 'ride-hailing-demand-heatmap')!.reasons).toContain(
      'shown for 2 recent video(s) −2',
    );
  });
});

describe('directorReferences', () => {
  it('briefs the picks in order and records them for the usage history', () => {
    const refs = directorReferences(t.db, t.dataDir, {
      topicTitle: TOPICS['rate-limiter'].title,
      seriesTag: 'system-design',
      notes: fixtureNotes('rate-limiter'),
      memory: noMemory,
    });
    expect(refs.briefs.map((b) => b.label)).toEqual(['Reference A', 'Reference B', 'Reference C']);
    expect(refs.briefs[0]!.hook).toMatch(/^puzzle\/failure_before_fix: /);
    expect(JSON.stringify(refs.briefs)).not.toContain('database-failover');
    expect(referenceUsage({ references: refs } as Parameters<typeof referenceUsage>[0])).toEqual(
      refs.picks.map((p) => ({ kind: 'reference', value: p.slug })),
    );
    expect(t.db.select().from(usageHistory).all()).toEqual([]);
  });

  it('lists every ready reference’s names for the originality check', () => {
    const all = referenceNamesToAvoid(t.db, t.dataDir);
    expect(all.map((r) => r.slug)).toEqual([...SEED_SLUGS]);
    expect(all.find((r) => r.slug === 'ride-hailing-demand-heatmap')?.names).toEqual([
      { text: 'Uber', kind: 'brand' },
      { text: 'DevMonk', kind: 'brand' },
    ]);
    const row = requireReference(t.db, 'seat-booking-contention');
    const record = { ...seedRecord(row.slug), namesToAvoid: [{ text: 'Ticketo', kind: 'brand' }] };
    t.db.transaction((tx) => editReferenceRecord(tx, t.dataDir, row.id, record));
    expect(referenceNamesToAvoid(t.db, t.dataDir).at(-1)).toEqual({
      slug: 'seat-booking-contention',
      names: [{ text: 'Ticketo', kind: 'brand' }],
    });
    expect(seedNames('seat-booking-contention')).toEqual([
      { text: 'BookMyShow', kind: 'brand' },
      { text: 'DevMonk', kind: 'brand' },
    ]);
  });
});
