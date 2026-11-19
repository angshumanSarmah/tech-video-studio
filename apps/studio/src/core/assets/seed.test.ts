import { SEED_ASSETS } from '@explainer-studio/renderer/catalog';
import { eq } from 'drizzle-orm';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/testing.ts';
import { assets } from '../db/schema.ts';
import { seedAssets } from './seed.ts';

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
    expect(seedAssets(t.db, t.dataDir)).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: SEED_ASSETS.length,
    });
    expect(row('gpu')).toMatchObject({ tags: ['edited'], name: 'Edited' });
  });

  it('refreshes a seeded row on a source or style bump, or a missing file', () => {
    t.db.update(assets).set({ source: 'lucide@0.1.0:gpu' }).where(eq(assets.id, 'gpu')).run();
    t.db.update(assets).set({ styleVersion: 0 }).where(eq(assets.id, 'cpu')).run();
    rmSync(join(t.dataDir, 'assets', 'bot.svg'));
    expect(seedAssets(t.db, t.dataDir)).toMatchObject({ inserted: 0, updated: 3 });
    expect(row('gpu')?.source).toMatch(/^lucide@[\d.]+:gpu$/);
    expect(row('gpu')?.source).not.toBe('lucide@0.1.0:gpu');
    expect(row('cpu')?.styleVersion).toBe(1);
    expect(readFileSync(join(t.dataDir, 'assets', 'bot.svg'), 'utf8')).toContain('<svg');
  });

  it('never touches rows the seed did not create', () => {
    t.db.update(assets).set({ source: 'uploaded' }).where(eq(assets.id, 'gpu')).run();
    writeFileSync(join(t.dataDir, 'assets', 'gpu.svg'), 'user file');
    expect(seedAssets(t.db, t.dataDir).updated).toBe(0);
    expect(readFileSync(join(t.dataDir, 'assets', 'gpu.svg'), 'utf8')).toBe('user file');
  });
});
