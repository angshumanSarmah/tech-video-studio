import { ASSET_FAMILIES, LibraryAssetSchema, SpecIdSchema } from '@explainer-studio/shared';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHouseSvg, serializeHouseSvg } from './house-svg.ts';
import { FEATHER_DERIVED, LUCIDE_VERSION, lucideFileName, SEED_ASSETS } from './seed.ts';

const lucideDir = dirname(createRequire(import.meta.url).resolve('lucide/package.json'));

/** Lucide renamed some Feather icons; the licence lists the old names. */
const FEATHER_NAMES: Record<string, string> = {
  'triangle-exclamation-point': 'alert-triangle',
  'circle-x': 'x-circle',
};

/** Ids the temporary built-in set had: fixtures, patterns and old specs use them. */
const KEPT_IDS = [
  'server',
  'database',
  'disk',
  'cpu',
  'cloud',
  'globe',
  'user',
  'users',
  'lock',
  'key',
  'shield',
  'zap',
  'clock',
  'list',
  'layers',
  'mail',
  'bell',
  'bot',
  'crown',
  'smartphone',
  'car',
  'bike',
  'ticket',
  'package',
  'shopping_bag',
  'credit_card',
  'pizza',
  'coffee',
  'document',
  'map_pin',
];

describe('seed assets', () => {
  it('are valid library assets with unique slug ids', () => {
    for (const asset of SEED_ASSETS) {
      expect(LibraryAssetSchema.safeParse(asset).success, asset.id).toBe(true);
      expect(SpecIdSchema.safeParse(asset.id).success, asset.id).toBe(true);
    }
    expect(new Set(SEED_ASSETS.map((a) => a.id)).size).toBe(SEED_ASSETS.length);
  });

  it('cover every family and keep the built-in ids', () => {
    expect(new Set(SEED_ASSETS.map((a) => a.family))).toEqual(new Set(ASSET_FAMILIES));
    const ids = new Set(SEED_ASSETS.map((a) => a.id));
    expect(KEPT_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('round-trip through the house SVG file format', () => {
    for (const asset of SEED_ASSETS) {
      expect(parseHouseSvg(serializeHouseSvg(asset.shapes)), asset.id).toEqual({
        ok: true,
        shapes: asset.shapes,
      });
    }
  });

  it('record the installed Lucide version as their source', () => {
    const pkg = JSON.parse(readFileSync(join(lucideDir, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(LUCIDE_VERSION).toBe(pkg.version);
    for (const asset of SEED_ASSETS) expect(asset.source).toMatch(/^lucide@[\d.]+:[a-z0-9-]+$/);
  });

  it('record ISC AND MIT exactly for icons Lucide derived from Feather', () => {
    const licence = readFileSync(join(lucideDir, 'LICENSE'), 'utf8');
    const listed = licence.split('Feather project:')[1]?.split('The MIT License')[0] ?? '';
    const feather = new Set(listed.split(',').map((n) => n.trim()));
    for (const asset of SEED_ASSETS) {
      const file = asset.source.split(':')[1] ?? '';
      const derived = feather.has(FEATHER_NAMES[file] ?? file);
      expect(FEATHER_DERIVED.has(file), file).toBe(derived);
      expect(asset.licence, asset.id).toBe(derived ? 'ISC AND MIT' : 'ISC');
    }
  });

  it('name Lucide files the way Lucide does', () => {
    expect(lucideFileName('HardDrive')).toBe('hard-drive');
    expect(lucideFileName('Gamepad2')).toBe('gamepad-2');
    expect(lucideFileName('MousePointer2')).toBe('mouse-pointer-2');
    for (const asset of SEED_ASSETS) {
      const file = asset.source.split(':')[1] ?? '';
      expect(
        () => readFileSync(join(lucideDir, 'dist/esm/icons', `${file}.mjs`)),
        file,
      ).not.toThrow();
    }
  });
});
