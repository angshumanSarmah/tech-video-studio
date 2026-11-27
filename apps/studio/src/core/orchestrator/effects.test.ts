import { rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import type { VideoSpec } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRunAssetRequests } from '../db/repositories/asset-requests.ts';
import { createRun, getRun } from '../db/repositories/runs.ts';
import { listSeries } from '../db/repositories/series.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import { saveSpecVersion } from '../services/spec-versions.ts';
import { EFFECTS } from './effects.ts';

let t: TestDb;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.cleanup());

describe('board_backlog', () => {
  it("records the latest spec's asset requests in asset_requests, once per id", () => {
    const run = createRun(t.db, {
      app: TEST_APP_SETTINGS,
      topicId: createTopic(t.db, { title: 'Vaults' }).id,
      seriesId: listSeries(t.db)[0]!.id,
    });
    const spec = structuredClone(rateLimiterSpec) as VideoSpec;
    const scene = spec.scenes![0]!;
    scene.elements.push({
      id: 'vault',
      primitive: 'node_card',
      props: { title: 'Vault', icon: 'vault_door' },
    });
    scene.missingAssetRequests = [
      {
        assetId: 'vault_door',
        description: 'A round vault door.',
        family: 'security',
        closest: 'lock',
      },
    ];
    saveSpecVersion(t.db, t.dataDir, { runId: run.id, spec, createdBy: 'agent' });
    const effect = EFFECTS.board_backlog!;
    const ctx = { tx: t.db, dataDir: t.dataDir, run: getRun(t.db, run.id)!, advancePart: () => {} };
    expect(effect(ctx, 'retime')).toBe('retime');
    effect(ctx, 'retime');
    expect(listRunAssetRequests(t.db, run.id)).toEqual([
      expect.objectContaining({
        assetId: 'vault_door',
        beatIds: ['hook'],
        family: 'security',
        closest: 'lock',
        topicId: null,
      }),
    ]);
  });
});
