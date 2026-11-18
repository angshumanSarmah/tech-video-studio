import { SpecIdSchema } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { ASSETS, BUILTIN_ASSETS, buildAssetRegistry, getAsset } from './builtin.ts';

describe('built-in assets', () => {
  it('have unique slug ids and drawable glyphs', () => {
    for (const asset of BUILTIN_ASSETS) {
      expect(SpecIdSchema.safeParse(asset.id).success, asset.id).toBe(true);
      expect(asset.glyph.length, asset.id).toBeGreaterThan(0);
    }
    expect(ASSETS.size).toBe(BUILTIN_ASSETS.length);
  });

  it('include both service icons and everyday items', () => {
    const kinds = new Set(BUILTIN_ASSETS.map((a) => a.kind));
    expect(kinds).toEqual(new Set(['icon', 'item']));
  });

  it('look ids up, returning undefined for unknown ids (drawn as a placeholder)', () => {
    expect(getAsset('server')?.label).toBe('Server');
    expect(getAsset('rocket_ship')).toBeUndefined();
    expect(getAsset('toString')).toBeUndefined();
  });

  it('rejects duplicate ids', () => {
    const [first] = BUILTIN_ASSETS;
    if (!first) throw new Error('no assets');
    expect(() => buildAssetRegistry([first, first])).toThrow(/Duplicate asset id/);
  });
});
