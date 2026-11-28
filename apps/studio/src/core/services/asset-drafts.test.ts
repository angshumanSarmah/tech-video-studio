import { MAX_AUTO_DRAFTS_PER_VIDEO } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SpecAssetRequest } from '../assets/run-asset-requests.ts';
import { createRun, type Run } from '../db/repositories/runs.ts';
import { listSeries } from '../db/repositories/series.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import {
  assetRow,
  createDraft,
  nameOf,
  queueRequestedDrafts,
  slugOf,
  videoAutoDrafts,
} from './asset-drafts.ts';

let t: TestDb;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.cleanup());

function run(part?: { parentRunId: number; index: number; count: number }): Run {
  return createRun(t.db, {
    app: TEST_APP_SETTINGS,
    topicId: createTopic(t.db, { title: 'Vaults' }).id,
    seriesId: listSeries(t.db)[0]!.id,
    ...(part ? { part } : {}),
  });
}

const request = (assetId: string): SpecAssetRequest => ({
  assetId,
  description: `<${assetId}>`,
  family: 'object',
  closest: 'server',
  beatIds: ['b1'],
});

describe('auto-drafting a run’s requests', () => {
  it(`queues at most ${MAX_AUTO_DRAFTS_PER_VIDEO} drafts a video, across its parts`, () => {
    const parent = run();
    const part1 = run({ parentRunId: parent.id, index: 1, count: 2 });
    const part2 = run({ parentRunId: parent.id, index: 2, count: 2 });
    const first = queueRequestedDrafts(t.db, part1, [request('vault_a'), request('vault_b')]);
    expect(first.map((j) => j.payload)).toEqual([
      { assetId: 'vault_a', round: 1, requestedByRunId: part1.id },
      { assetId: 'vault_b', round: 1, requestedByRunId: part1.id },
    ]);
    const second = queueRequestedDrafts(t.db, part2, [request('vault_c'), request('vault_d')]);
    expect(second.map((j) => (j.payload as { assetId: string }).assetId)).toEqual(['vault_c']);
    expect(videoAutoDrafts(t.db, parent)).toHaveLength(3);
    expect(assetRow(t.db, 'vault_d')).toBeUndefined();
    expect(assetRow(t.db, 'vault_a')).toMatchObject({
      status: 'draft',
      name: 'Vault a',
      description: '<vault_a>',
      svgPath: null,
    });
    expect(queueRequestedDrafts(t.db, run(), [request('vault_e')])).toHaveLength(1);
  });

  it('never drafts an id that has a row (a draft, an approved one) again', () => {
    t.db.transaction((tx) =>
      createDraft(tx, { name: 'Vault', family: 'object', description: 'A vault door.' }),
    );
    const queued = queueRequestedDrafts(t.db, run(), [request('vault'), request('server')]);
    expect(queued).toEqual([]);
  });

  it('draws nothing with the run’s assets.autoDraft off', () => {
    const off = {
      ...run(),
      resolvedSettings: { ...run().resolvedSettings, assets: { autoDraft: false } },
    };
    expect(queueRequestedDrafts(t.db, off, [request('vault')])).toEqual([]);
  });
});

describe('names and ids', () => {
  it('slugs a name and names an id', () => {
    expect(slugOf('Write-ahead log')).toBe('write_ahead_log');
    expect(nameOf('write_ahead_log')).toBe('Write ahead log');
  });
});
