import { rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import type { MissingAssetRequest, VideoSpec } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRunAssetRequests, recordAssetRequests } from '../db/repositories/asset-requests.ts';
import { createRun } from '../db/repositories/runs.ts';
import { listSeries } from '../db/repositories/series.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import { specAssetRequests } from './run-asset-requests.ts';

const request = (assetId: string): MissingAssetRequest => ({
  assetId,
  description: `A ${assetId.replaceAll('_', ' ')}.`,
  family: 'object',
  closest: 'server',
});

/** `vault_door` on beats 0 and 2 (requested on 0, twice), `tape_reel` requested but unused. */
function spec(): VideoSpec {
  const s = structuredClone(rateLimiterSpec) as VideoSpec;
  const scenes = s.scenes ?? [];
  for (const i of [0, 2]) {
    scenes[i]?.elements.push({
      id: `vault-${i}`,
      primitive: 'node_card',
      props: { title: 'Vault', icon: 'vault_door' },
    });
  }
  scenes[0]!.missingAssetRequests = [request('vault_door')];
  scenes[1]!.missingAssetRequests = [request('tape_reel')];
  scenes[2]!.missingAssetRequests = [{ ...request('vault_door'), description: 'Later.' }];
  return s;
}

describe('specAssetRequests', () => {
  it('gives one request per id its boards use, the first board’s, with every beat using it', () => {
    expect(specAssetRequests(spec(), () => false)).toEqual([
      { ...request('vault_door'), beatIds: ['hook', 'bucket-empty'] },
    ]);
  });

  it('leaves out ids approved since', () => {
    expect(specAssetRequests(spec(), (id) => id === 'vault_door')).toEqual([]);
  });
});

describe('recordAssetRequests', () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.cleanup());

  it('keeps one row per id and run, refreshed when recorded again', () => {
    const run = createRun(t.db, {
      app: TEST_APP_SETTINGS,
      topicId: createTopic(t.db, { title: 'Vaults' }).id,
      seriesId: listSeries(t.db)[0]!.id,
    });
    const [first] = specAssetRequests(spec(), () => false);
    recordAssetRequests(t.db, run.id, [first!]);
    const rows = recordAssetRequests(t.db, run.id, [
      { ...first!, beatIds: ['hook'], closest: 'key' },
    ]);
    expect(rows).toHaveLength(1);
    expect(listRunAssetRequests(t.db, run.id)[0]).toMatchObject({
      assetId: 'vault_door',
      runId: run.id,
      beatIds: ['hook'],
      closest: 'key',
      family: 'object',
    });
  });
});
