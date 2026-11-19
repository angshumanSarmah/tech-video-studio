import type { LibraryAsset, LogoFile } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import {
  assetContext,
  buildAssetRegistry,
  placeholderLabel,
  resolveGlyph,
  SEED_REGISTRY,
} from './library.ts';
import { SEED_ASSETS } from './seed.ts';

const server = SEED_REGISTRY.get('server') as LibraryAsset;
const logo: LogoFile = {
  kind: 'logo',
  id: 'logo_example',
  mime: 'image/png',
  dataUri: 'data:image/png;base64,iVBORw0KGgo=',
};
const slots = [
  { id: 'logo_example', label: '<example-company>' },
  { id: 'logo_other', label: '<example-other>' },
];

describe('asset registry', () => {
  it('holds the seed library by default', () => {
    expect(SEED_REGISTRY.size).toBe(SEED_ASSETS.length);
  });

  it('rejects duplicate ids and invalid assets', () => {
    expect(() => buildAssetRegistry([server, server])).toThrow(/Duplicate asset id/);
    expect(() => buildAssetRegistry([{ ...server, id: 'logo_x' }])).toThrow(/Invalid asset/);
    expect(() => buildAssetRegistry([{ ...server, shapes: [] }])).toThrow(/Invalid asset/);
  });
});

describe('assetContext and resolveGlyph', () => {
  it('uses the seed library when the render passes no assets', () => {
    const context = assetContext(undefined, undefined);
    expect(resolveGlyph('server', context)).toEqual({ kind: 'library', asset: server });
  });

  it('uses only the resolved assets when given, so DB gaps show as placeholders', () => {
    const context = assetContext(slots, [server, logo]);
    expect(resolveGlyph('server', context).kind).toBe('library');
    expect(resolveGlyph('database', context)).toEqual({
      kind: 'placeholder',
      label: 'database',
      reason: 'unknown_asset',
    });
  });

  it('draws filled logo slots from their file and unfilled ones as labelled placeholders', () => {
    const context = assetContext(slots, [logo]);
    expect(resolveGlyph('logo_example', context)).toEqual({
      kind: 'logo',
      file: logo,
      label: '<example-company>',
    });
    expect(resolveGlyph('logo_other', context)).toEqual({
      kind: 'placeholder',
      label: '<example-other>',
      reason: 'unfilled_logo',
    });
  });

  it('ignores logo files for slots the spec does not declare', () => {
    const context = assetContext([], [logo]);
    expect(resolveGlyph('logo_example', context)).toMatchObject({
      kind: 'placeholder',
      label: 'example',
    });
  });

  it('labels placeholders readably', () => {
    expect(placeholderLabel('rocket_ship')).toBe('rocket ship');
    expect(placeholderLabel('gpu-card')).toBe('gpu card');
    expect(placeholderLabel('logo_example-co')).toBe('example co');
  });
});
