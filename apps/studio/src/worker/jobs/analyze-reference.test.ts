import { join } from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson } from '#core/data-files.ts';
import { listReferenceBacklog } from '#core/db/repositories/backlog.ts';
import { llmCalls } from '#core/db/schema.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { addReference, readReferenceRecord, requireReference } from '#core/services/references.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import {
  analysisRunner,
  answer,
  noSeedReferences,
  REFERENCE_RESPONSES_DIR,
  runAnalysis,
  SEED_SLUGS,
  seedBreakdown,
  seedRecord,
} from '../agents/reference/testing.ts';
import { loadDryRunFixtures, type DryRunResponse } from '../llm/dry-run.ts';

const root = findWorkspaceRoot(import.meta.dirname);
const recorded = loadDryRunFixtures(join(root, REFERENCE_RESPONSES_DIR))
  .reference as DryRunResponse[];

let t: TestDb;
beforeEach(() => {
  t = createTestDb(noSeedReferences());
});
afterEach(() => t.cleanup());

function referenceCalls() {
  return t.db
    .select()
    .from(llmCalls)
    .where(and(isNull(llmCalls.runId), eq(llmCalls.role, 'reference')))
    .orderBy(asc(llmCalls.id))
    .all();
}

function paste(slug: string, breakdown = seedBreakdown(slug)) {
  return t.db.transaction((tx) => addReference(tx, t.dataDir, { breakdown, title: slug }));
}

describe('analyze_reference', () => {
  it('replays the six recorded seed analyses into the committed records', async () => {
    const run = analysisRunner(t.db, t.dataDir, recorded);
    for (const slug of SEED_SLUGS) {
      const { job } = paste(slug);
      expect((await run(job.id)).status).toBe('done');
      const row = requireReference(t.db, slug);
      expect(row.status).toBe('ready');
      expect(readReferenceRecord(t.dataDir, row)).toEqual(seedRecord(slug));
    }
    // Every recorded answer used, repairs included: none left over, none missing.
    expect(referenceCalls()).toHaveLength(recorded.length);
  });

  it('sends no screenshot to the model', async () => {
    const { job } = t.db.transaction((tx) =>
      addReference(tx, t.dataDir, { breakdown: seedBreakdown('live-score-fanout') }, [
        { name: 'frame.png', bytes: new Uint8Array([1, 2, 3]) },
      ]),
    );
    await runAnalysis(t.db, t.dataDir, job.id, [answer(seedRecord('live-score-fanout'))]);
    const [call] = referenceCalls();
    const prompt = JSON.stringify(readDataJson(t.dataDir, call!.promptPath));
    expect(prompt).not.toMatch(/frame\.png|attachments\//);
    expect(prompt).toContain('BUILT INTO THE RENDERER');
    expect(prompt).toContain('split_brain');
  });

  it('turns a pasted breakdown’s missing primitive into a backlog row for that reference', async () => {
    const record = seedRecord('live-score-fanout');
    const withMissing = {
      ...record,
      unmapped: [
        {
          kind: 'primitive',
          name: 'stamp_effect',
          description: 'A rubber stamp marks a record as a repeat.',
          closest: 'tag',
          buildable: 'yes',
        },
      ],
    };
    const { row, job } = paste('live-score-fanout');
    await runAnalysis(t.db, t.dataDir, job.id, [answer(withMissing)]);
    expect(
      listReferenceBacklog(t.db, row.id).map((b) => [b.name, b.referenceVideoId, b.runId]),
    ).toEqual([['stamp_effect', row.id, null]]);
  });

  it('repairs an answer that fails the checks, with the reasons', async () => {
    const record = seedRecord('live-score-fanout');
    const branded = { ...record, arc: 'Fans open Scorely → steps → payoff' };
    const { row, job } = t.db.transaction((tx) =>
      addReference(tx, t.dataDir, {
        breakdown: seedBreakdown('live-score-fanout'),
        namesToAvoid: [{ text: 'Scorely', kind: 'brand' }],
      }),
    );
    const ran = await runAnalysis(t.db, t.dataDir, job.id, [answer(branded), answer(record)]);
    expect(ran.status).toBe('done');
    const calls = referenceCalls();
    expect(calls.map((c) => c.error?.match(/\[([^\]]+)\]/)?.[1] ?? null)).toEqual([
      'name_in_structure',
      null,
    ]);
    const saved = readReferenceRecord(t.dataDir, requireReference(t.db, row.id));
    // The person's name is kept on the record even though the analyst left it out.
    expect(saved?.namesToAvoid.map((n) => n.text)).toContain('Scorely');
  });

  it('marks the reference failed when no answer passes', async () => {
    const bad = { ...seedRecord('live-score-fanout'), arc: 'Open the app for 5 minutes' };
    const { row, job } = paste('live-score-fanout');
    const done = await runAnalysis(t.db, t.dataDir, job.id, [
      answer(bad),
      answer(bad),
      answer(bad),
    ]);
    expect(done.status).toBe('failed');
    const failed = requireReference(t.db, row.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/"5" is a number from the original/);
  });

  it('leaves a reference that is no longer pending', async () => {
    const { row, job } = paste('live-score-fanout');
    t.db.transaction((tx) => addReference(tx, t.dataDir, { breakdown: 'x', title: 'other' }));
    await runAnalysis(t.db, t.dataDir, job.id, [answer(seedRecord('live-score-fanout'))]);
    expect(requireReference(t.db, row.id).status).toBe('ready');
    // A second delivery of the same job (at-least-once) calls nothing.
    expect(referenceCalls()).toHaveLength(1);
  });
});
