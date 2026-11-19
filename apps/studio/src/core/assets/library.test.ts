import { eq } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/testing.ts';
import { assets } from '../db/schema.ts';
import { loadAssetLibrary } from './library.ts';

let t: TestDb;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.cleanup());

describe('loadAssetLibrary', () => {
  it('loads approved assets with their parsed shapes, optionally only some ids', () => {
    const { assets: loaded, problems } = loadAssetLibrary(t.db, t.dataDir, ['server', 'nope']);
    expect(problems).toEqual([]);
    expect(loaded.map((a) => [a.kind, a.id, a.family])).toEqual([['library', 'server', 'infra']]);
    expect(loaded[0]?.shapes.length).toBeGreaterThan(0);
    expect(loadAssetLibrary(t.db, t.dataDir).assets.length).toBeGreaterThan(50);
    expect(loadAssetLibrary(t.db, t.dataDir, [])).toEqual({ assets: [], problems: [] });
  });

  it('leaves out drafts', () => {
    t.db.update(assets).set({ status: 'draft' }).where(eq(assets.id, 'server')).run();
    expect(loadAssetLibrary(t.db, t.dataDir, ['server']).assets).toEqual([]);
  });

  it('reports a corrupt or unsafe SVG instead of throwing', () => {
    writeFileSync(
      join(t.dataDir, 'assets', 'server.svg'),
      '<svg viewBox="0 0 24 24"><script/></svg>',
    );
    writeFileSync(join(t.dataDir, 'assets', 'cpu.svg'), 'not xml <');
    const { assets: loaded, problems } = loadAssetLibrary(t.db, t.dataDir, [
      'server',
      'cpu',
      'gpu',
    ]);
    expect(loaded.map((a) => a.id)).toEqual(['gpu']);
    expect(problems.map((p) => p.id).sort()).toEqual(['cpu', 'server']);
    expect(problems.find((p) => p.id === 'server')?.message).toMatch(/<script> is not allowed/);
  });
});
