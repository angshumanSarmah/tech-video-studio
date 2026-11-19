import { rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import type { MissingAsset, VideoSpec } from '@explainer-studio/shared';
import { eq } from 'drizzle-orm';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/testing.ts';
import { assets } from '../db/schema.ts';
import { prepareRenderAssets, readMissingAssets, recordMissingAssets } from './render-assets.ts';

let t: TestDb;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.cleanup());

const RUN_ID = 3;

/** The rate-limiter fixture with a logo slot on `api` and an unknown icon on `client`. */
function specWithGaps(): VideoSpec {
  const spec = structuredClone(rateLimiterSpec) as VideoSpec;
  const [client, api] = spec.scenes?.[0]?.elements ?? [];
  if (!client || !api) throw new Error('fixture changed');
  client.props = { title: 'Client', icon: 'rocket_ship' };
  api.props = { title: 'API', icon: 'logo_example' };
  return { ...spec, logos: [{ id: 'logo_example', label: '<example-company>' }] };
}

function addLogo(): void {
  const dir = join(t.dataDir, 'runs', String(RUN_ID), 'logos');
  mkdirSync(dir, { recursive: true });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#e33"/></svg>';
  writeFileSync(join(dir, 'logo_example.svg'), svg);
}

describe('prepareRenderAssets', () => {
  it('passes only the library assets the spec uses', () => {
    const result = prepareRenderAssets(t.db, t.dataDir, RUN_ID, rateLimiterSpec);
    expect(result.assets.map((a) => a.id).sort()).toEqual(['server', 'shield', 'user']);
    expect(result.missing).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  it('lists unknown ids and unfilled logo slots as missing', () => {
    const result = prepareRenderAssets(t.db, t.dataDir, RUN_ID, specWithGaps());
    expect(result.missing.map((m) => [m.id, m.kind, m.label])).toEqual([
      ['rocket_ship', 'asset', 'rocket ship'],
      ['logo_example', 'logo', '<example-company>'],
    ]);
  });

  it('fills a logo slot from the run folder', () => {
    addLogo();
    const result = prepareRenderAssets(t.db, t.dataDir, RUN_ID, specWithGaps());
    expect(result.assets).toContainEqual(
      expect.objectContaining({ kind: 'logo', id: 'logo_example', mime: 'image/svg+xml' }),
    );
    expect(result.missing.map((m) => m.id)).toEqual(['rocket_ship']);
  });

  it('treats an asset that is no longer approved as missing', () => {
    t.db.update(assets).set({ status: 'rejected' }).where(eq(assets.id, 'shield')).run();
    const result = prepareRenderAssets(t.db, t.dataDir, RUN_ID, rateLimiterSpec);
    expect(result.missing.map((m) => m.id)).toEqual(['shield']);
  });
});

describe('recordMissingAssets', () => {
  const item = (id: string, beatId: string): MissingAsset => ({
    id,
    kind: 'asset',
    label: id,
    uses: [{ beatId, path: `$.${beatId}` }],
  });

  it('writes the list per run and merges per-beat renders', () => {
    expect(readMissingAssets(t.dataDir, RUN_ID)).toEqual([]);
    recordMissingAssets(t.dataDir, RUN_ID, [item('a', 'hook'), item('b', 'payoff')]);
    const after = recordMissingAssets(t.dataDir, RUN_ID, [], ['hook']);
    expect(after).toEqual([item('b', 'payoff')]);
    expect(readMissingAssets(t.dataDir, RUN_ID)).toEqual(after);
  });
});
