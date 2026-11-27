import { rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import type { VideoSpec } from '@explainer-studio/shared';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAssetLibrary } from '../assets/library.ts';
import { prepareRenderAssets } from '../assets/render-assets.ts';
import { createTestDb, type TestDb } from '../db/testing.ts';
import { ConflictError, InvalidEditError } from '../errors.ts';
import { uploadAsset } from './asset-upload.ts';

let t: TestDb;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.cleanup());

const PLUG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">
  <title>Plug</title>
  <g fill="none" stroke="currentColor" stroke-width="2">
    <path d="M9 2v6M15 2v6" />
    <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
    <path d="M12 18v4" />
  </g>
</svg>`;

const request = (more: Record<string, unknown> = {}) => ({
  svg: PLUG,
  id: 'wall_plug',
  name: 'Wall plug',
  family: 'infra',
  tags: ['Power', 'socket'],
  ...more,
});

describe('uploadAsset', () => {
  it('stores a sanitized house SVG as an approved asset a render can use by id', () => {
    const { asset, fixes } = uploadAsset(t.db, t.dataDir, request({ aliases: ['power_plug'] }));
    expect(asset).toMatchObject({
      id: 'wall_plug',
      status: 'approved',
      licence: 'LicenseRef-own',
      source: 'uploaded',
      tags: ['power', 'socket'],
      aliases: ['power_plug'],
      svgPath: 'assets/wall_plug.svg',
    });
    expect(fixes).toEqual(expect.arrayContaining(['<title> dropped.', 'Groups flattened.']));
    const file = readFileSync(join(t.dataDir, 'assets', 'wall_plug.svg'), 'utf8');
    expect(file).not.toContain('<title>');
    expect(loadAssetLibrary(t.db, t.dataDir, ['wall_plug']).assets).toHaveLength(1);

    const spec = structuredClone(rateLimiterSpec) as VideoSpec;
    spec.scenes![0]!.elements[0]!.props = { title: 'Client', icon: 'wall_plug' };
    const render = prepareRenderAssets(t.db, t.dataDir, 1, spec);
    expect(render.missing).toEqual([]);
    expect(render.assets.map((a) => a.id)).toContain('wall_plug');
  });

  it('refuses an unsafe file with every problem, and writes nothing', () => {
    const svg = PLUG.replace('<title>Plug</title>', '<script>alert(1)</script>');
    const error = catchError(() => uploadAsset(t.db, t.dataDir, request({ svg })));
    expect(error).toBeInstanceOf(InvalidEditError);
    expect((error as InvalidEditError).issues).toEqual([
      { path: '$.svg', message: 'Refused: <script> is not allowed in an asset.' },
    ]);
    expect(existsSync(join(t.dataDir, 'assets', 'wall_plug.svg'))).toBe(false);
  });

  it('refuses an id that exists, bad details and aliases another asset has', () => {
    expect(() => uploadAsset(t.db, t.dataDir, request({ id: 'server' }))).toThrow(ConflictError);
    const bad = catchError(() => uploadAsset(t.db, t.dataDir, request({ id: 'Wall Plug' })));
    expect((bad as InvalidEditError).issues[0]?.path).toBe('$.id');
    const taken = catchError(() => uploadAsset(t.db, t.dataDir, request({ aliases: ['server'] })));
    expect((taken as InvalidEditError).issues[0]?.message).toMatch(/id of another asset/);
    expect(existsSync(join(t.dataDir, 'assets', 'wall_plug.svg'))).toBe(false);
  });

  it('keeps a third-party licence and source when given', () => {
    const { asset } = uploadAsset(
      t.db,
      t.dataDir,
      request({ licence: 'MIT', source: 'tabler@3.0.0:plug' }),
    );
    expect(asset).toMatchObject({ licence: 'MIT', source: 'tabler@3.0.0:plug' });
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
}
