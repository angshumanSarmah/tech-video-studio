import { describe, expect, it } from 'vitest';
import {
  AssetShapeSchema,
  LibraryAssetIdSchema,
  LOGO_MAX_BYTES,
  LogoFileSchema,
  ResolvedAssetSchema,
} from './assets.ts';

describe('asset schemas', () => {
  it('reserve the logo_ prefix for logo slots', () => {
    expect(LibraryAssetIdSchema.safeParse('server').success).toBe(true);
    expect(LibraryAssetIdSchema.safeParse('logo_example').success).toBe(false);
  });

  it('allow only house shapes and palette tokens', () => {
    const ok = { tag: 'circle', attrs: { cx: '12', cy: '12', r: '4', fill: 'var(--asset-fill)' } };
    expect(AssetShapeSchema.safeParse(ok).success).toBe(true);
    const red = { tag: 'circle', attrs: { cx: '12', cy: '12', r: '4', fill: '#ff0000' } };
    expect(AssetShapeSchema.safeParse(red).success).toBe(false);
    const handler = { tag: 'path', attrs: { d: 'M0 0', onclick: 'x()' } };
    expect(AssetShapeSchema.safeParse(handler).success).toBe(false);
    expect(AssetShapeSchema.safeParse({ tag: 'image', attrs: {} }).success).toBe(false);
  });

  it('accept logo files only as small base64 data URIs', () => {
    const logo = {
      kind: 'logo',
      id: 'logo_example',
      mime: 'image/png',
      dataUri: 'data:image/png;base64,iVBORw0KGgo=',
    };
    expect(LogoFileSchema.safeParse(logo).success).toBe(true);
    expect(
      LogoFileSchema.safeParse({ ...logo, dataUri: 'https://example.com/x.png' }).success,
    ).toBe(false);
    const huge = `data:image/png;base64,${'A'.repeat(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 100)}`;
    expect(LogoFileSchema.safeParse({ ...logo, dataUri: huge }).success).toBe(false);
  });

  it('discriminate library assets from logo files', () => {
    const library = {
      kind: 'library',
      id: 'server',
      name: 'Server',
      family: 'infra',
      tags: [],
      styleVersion: 1,
      licence: 'ISC',
      source: 'lucide@1.0.0:server',
      shapes: [{ tag: 'path', attrs: { d: 'M0 0h24' } }],
    };
    expect(ResolvedAssetSchema.safeParse(library).success).toBe(true);
    expect(ResolvedAssetSchema.safeParse({ ...library, family: 'misc' }).success).toBe(false);
  });
});
