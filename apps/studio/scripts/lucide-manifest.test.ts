import { FEATHER_DERIVED, SEED_ASSETS } from '@explainer-studio/renderer/catalog';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  defaultLucideManifestPath,
  lucideImportAssets,
  readLucideManifest,
} from '#core/assets/lucide-import.ts';
import {
  buildLucideManifest,
  importEntries,
  isFeatherDerived,
  manifestProblems,
  pascalName,
  serializeLucideManifest,
  type LucideImportEntry,
} from '#core/assets/lucide-manifest.ts';
import { lucideFamily, ruleSkipReason } from '#core/assets/lucide-rules.ts';
import { lucideManifestInput } from './lucide-sources.ts';

const input = lucideManifestInput();
const built = buildLucideManifest(input);
const { manifest } = readLucideManifest();
const imported = new Map(importEntries(manifest).map((e) => [e.lucide, e]));
const entry = (name: string) => manifest.entries.find((e) => e.lucide === name);

describe('the committed Lucide manifest', () => {
  it('is what assets:manifest builds from the installed packages (run it and review the diff)', () => {
    expect(readFileSync(defaultLucideManifestPath(), 'utf8')).toBe(serializeLucideManifest(built));
  });

  it('lists every canonical Lucide icon once, in code-unit order', () => {
    const names = manifest.entries.map((e) => e.lucide);
    expect(names).toEqual(Object.keys(input.tags).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(new Set(names).size).toBe(names.length);
  });

  it('has no duplicate ids or alias conflicts with the core seed set', () => {
    expect(manifestProblems(manifest, SEED_ASSETS)).toEqual([]);
    const coreIds = new Set(SEED_ASSETS.map((a) => a.id));
    expect([...imported.values()].filter((e) => coreIds.has(e.id))).toEqual([]);
  });

  it('skips every core seed glyph and aliases its Lucide name to the seed id', () => {
    const seeded = manifest.entries.filter((e) => e.status === 'skip' && e.reason === 'seeded');
    const seedFiles = new Set(SEED_ASSETS.map((a) => a.source.split(':')[1]));
    for (const file of seedFiles)
      expect(entry(file ?? ''), file).toMatchObject({ reason: 'seeded' });
    expect(seeded.length).toBeGreaterThanOrEqual(SEED_ASSETS.length);
    expect(manifest.aliases).toMatchObject({
      hard_drive: 'disk',
      memory_stick: 'memory',
      funnel: 'filter',
    });
    expect(entry('clock-4')).toMatchObject({ reason: 'seeded', sameAs: 'clock' });
  });

  it('licenses icons the same way the core seed does (Lucide LICENSE, old names included)', () => {
    for (const asset of SEED_ASSETS) {
      const file = asset.source.split(':')[1] ?? '';
      const node = input.icons[pascalName(file)];
      const exportNames = Object.keys(input.icons).filter((n) => input.icons[n] === node);
      const derived = isFeatherDerived(file, exportNames, input.featherNames);
      expect(derived, file).toBe(FEATHER_DERIVED.has(file));
    }
    expect(imported.get('square-x')?.licence).toBe('ISC AND MIT');
    expect(imported.get('link-2')?.licence).toBe('ISC AND MIT');
    expect(imported.get('snail')?.licence).toBe('ISC');
  });

  it('imports the icons runs 1 and 3 had to stretch generic ones for', () => {
    const wanted: Record<string, Partial<LucideImportEntry>> = {
      plug: { id: 'plug', family: 'infra' },
      cable: { id: 'cable', family: 'network' },
      'ethernet-port': { id: 'ethernet_port', family: 'network' },
      snail: { id: 'snail', family: 'object' },
      turtle: { id: 'turtle', family: 'object' },
      'timer-off': { id: 'timer_off', family: 'time' },
      'database-zap': { id: 'database_zap', family: 'infra' },
      'wifi-off': { id: 'wifi_off', family: 'network' },
    };
    for (const [name, expected] of Object.entries(wanted)) {
      expect(imported.get(name), name).toMatchObject(expected);
    }
    expect(imported.get('snail')?.tags).toContain('slow');
  });

  it('renames the Lucide icons whose id a core seed id draws differently', () => {
    expect(imported.get('book')?.id).toBe('book_closed');
    expect(imported.get('pointer')?.id).toBe('hand_pointer');
  });

  it('gives every imported icon house shapes from the installed lucide', () => {
    const assets = lucideImportAssets(manifest);
    expect(assets).toHaveLength(imported.size);
    expect(assets.find((a) => a.id === 'snail')).toMatchObject({
      family: 'object',
      source: `lucide@${manifest.lucideVersion}:snail`,
    });
    expect(() => lucideImportAssets(manifest, input.icons, '0.0.1')).toThrow(/assets:manifest/);
  });
});

describe('Lucide import rules', () => {
  it.each([
    ['bluetooth', 'brand'],
    ['italic', 'text_formatting'],
    ['align-center-horizontal', 'text_formatting'],
    ['letter-a', 'letters_digits'],
    ['square-letter-b', 'letters_digits'],
    ['calendar-1', 'letters_digits'],
    ['zodiac-leo', 'off_topic'],
  ])('skips %s as %s', (name, reason) => {
    expect(ruleSkipReason(name)).toBe(reason);
    expect(entry(name)).toMatchObject({ status: 'skip', reason });
  });

  it.each([
    ['house-wifi', 'object'],
    ['file-clock', 'data'],
    ['square-terminal', 'dev'],
    ['circle-check-big', 'symbol'],
    ['circle-dashed', 'symbol'],
    ['cloud-rain', 'object'],
    ['cloud-upload', 'infra'],
    ['cable-car', 'transport'],
    ['rotate-cw-clock', 'time'],
    ['user-lock', 'people'],
  ])('files %s under %s', (name, family) => {
    expect(lucideFamily(name)).toBe(family);
  });
});
