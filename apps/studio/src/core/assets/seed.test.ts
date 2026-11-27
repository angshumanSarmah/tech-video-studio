import { SEED_ASSETS } from '@explainer-studio/renderer/catalog';
import type { VideoSpec } from '@explainer-studio/shared';
import { rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import { eq } from 'drizzle-orm';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/testing.ts';
import { assets, seedState } from '../db/schema.ts';
import { loadAssetLibrary } from './library.ts';
import { prepareRenderAssets } from './render-assets.ts';
import { assetSeed, seedAssets } from './seed.ts';

const core = () => assetSeed({ importLucide: false });
/** Forget the last seeding, as a new seed (a Lucide or manifest change) would. */
const forgetSeeding = () => t.db.delete(seedState).run();

let t: TestDb;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.cleanup());

const row = (id: string) => t.db.select().from(assets).where(eq(assets.id, id)).get();

describe('seedAssets', () => {
  it('stores every seed asset as an approved row and a house SVG file (via prepareDatabase)', () => {
    expect(t.db.select().from(assets).all()).toHaveLength(SEED_ASSETS.length);
    expect(row('gpu')).toMatchObject({
      name: 'GPU',
      family: 'ai',
      status: 'approved',
      licence: 'ISC',
      svgPath: 'assets/gpu.svg',
    });
    expect(row('gpu')?.source).toMatch(/^lucide@[\d.]+:gpu$/);
    expect(row('server')?.licence).toBe('ISC AND MIT');
    const svg = readFileSync(join(t.dataDir, 'assets', 'gpu.svg'), 'utf8');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/);
  });

  it('is idempotent and leaves user edits alone', () => {
    t.db
      .update(assets)
      .set({ tags: ['edited'], name: 'Edited' })
      .where(eq(assets.id, 'gpu'))
      .run();
    expect(seedAssets(t.db, t.dataDir, core())).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: SEED_ASSETS.length,
      aliased: 0,
      skipped: true,
    });
    forgetSeeding();
    expect(seedAssets(t.db, t.dataDir, core())).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: SEED_ASSETS.length,
      skipped: false,
    });
    expect(row('gpu')).toMatchObject({ tags: ['edited'], name: 'Edited' });
  });

  it('skips the per-row pass until the seed changes or a file goes missing', () => {
    expect(seedAssets(t.db, t.dataDir, core()).skipped).toBe(true);
    rmSync(join(t.dataDir, 'assets', 'bot.svg'));
    expect(seedAssets(t.db, t.dataDir, core())).toMatchObject({ skipped: false, updated: 1 });
    expect(seedAssets(t.db, t.dataDir, core()).skipped).toBe(true);
    expect(seedAssets(t.db, t.dataDir, { ...core(), hash: 'another seed' }).skipped).toBe(false);
  });

  it('adds the seed aliases to core rows, once, never one another row has', () => {
    expect(row('disk')?.aliases).toEqual(['hard_disk', 'hard_drive']);
    expect(row('gpu')?.aliases).toEqual(['gpu_card']);
    expect(row('filter')?.aliases).toEqual(['funnel']);
    t.db
      .update(assets)
      .set({ aliases: ['memory_stick'] })
      .where(eq(assets.id, 'cpu'))
      .run();
    t.db.update(assets).set({ aliases: [] }).where(eq(assets.id, 'memory')).run();
    forgetSeeding();
    expect(seedAssets(t.db, t.dataDir, core()).aliased).toBe(0);
    expect(row('memory')?.aliases).toEqual([]);
    const library = loadAssetLibrary(t.db, t.dataDir, ['disk']);
    expect(library.assets[0]?.aliases).toEqual(['hard_disk', 'hard_drive']);
  });

  it('refreshes a seeded row on a source or style bump, or a missing file', () => {
    t.db.update(assets).set({ source: 'lucide@0.1.0:gpu' }).where(eq(assets.id, 'gpu')).run();
    t.db.update(assets).set({ styleVersion: 0 }).where(eq(assets.id, 'cpu')).run();
    rmSync(join(t.dataDir, 'assets', 'bot.svg'));
    forgetSeeding();
    expect(seedAssets(t.db, t.dataDir, core())).toMatchObject({ inserted: 0, updated: 3 });
    expect(row('gpu')?.source).toMatch(/^lucide@[\d.]+:gpu$/);
    expect(row('gpu')?.source).not.toBe('lucide@0.1.0:gpu');
    expect(row('cpu')?.styleVersion).toBe(1);
    expect(readFileSync(join(t.dataDir, 'assets', 'bot.svg'), 'utf8')).toContain('<svg');
  });

  it('never touches rows the seed did not create', () => {
    t.db.update(assets).set({ source: 'uploaded' }).where(eq(assets.id, 'gpu')).run();
    writeFileSync(join(t.dataDir, 'assets', 'gpu.svg'), 'user file');
    forgetSeeding();
    expect(seedAssets(t.db, t.dataDir, core()).updated).toBe(0);
    expect(readFileSync(join(t.dataDir, 'assets', 'gpu.svg'), 'utf8')).toBe('user file');
  });
});

describe('seedAssets with the Lucide import', () => {
  it('adds every imported icon as approved, usable by id in a render, idempotently', () => {
    const seed = assetSeed();
    const result = seedAssets(t.db, t.dataDir, seed);
    expect(result).toMatchObject({ skipped: false, updated: 0 });
    expect(result.inserted).toBe(seed.assets.length - SEED_ASSETS.length);
    expect(row('snail')).toMatchObject({ status: 'approved', family: 'object', licence: 'ISC' });
    expect(row('snail')?.source).toMatch(/^lucide@[\d.]+:snail$/);
    expect(seedAssets(t.db, t.dataDir, seed).skipped).toBe(true);

    const spec = structuredClone(rateLimiterSpec) as VideoSpec;
    const client = spec.scenes?.[0]?.elements[0];
    if (!client) throw new Error('fixture changed');
    client.props = { title: 'Slow client', icon: 'snail' };
    const render = prepareRenderAssets(t.db, t.dataDir, 1, spec);
    expect(render.missing).toEqual([]);
    expect(render.problems).toEqual([]);
    const snail = render.assets.find((a) => a.id === 'snail');
    expect(snail).toMatchObject({ kind: 'library', family: 'object' });
    // Render props carry what is drawn, never the library-only fields.
    const disk = prepareRenderAssets(t.db, t.dataDir, 1, rateLimiterSpec).assets;
    expect(disk.every((a) => !('aliases' in a) && !('description' in a))).toBe(true);
  });
});
