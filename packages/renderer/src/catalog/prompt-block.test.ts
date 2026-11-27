import {
  ASSET_FAMILIES,
  DEVICE_IDS,
  METAPHOR_WORLD_IDS,
  renderLayoutModeCatalogue,
  renderStoryCatalogues,
  TOPIC_CLASS_CATALOGUE,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { allFixtureSpecs, goldenFixtures } from '../../fixtures/index.ts';
import { beatLayoutMode, DEFAULT_LAYOUT_MODE } from '../layout/modes.ts';
import { buildAssetRegistry, SEED_REGISTRY } from '../assets/library.ts';
import { buildPatternRegistry, PATTERN_DEFINITIONS, PATTERNS } from '../patterns/registry.ts';
import { buildPrimitiveRegistry, PRIMITIVE_DEFINITIONS } from '../primitives/registry.ts';
import { buildCatalogue } from './catalogue.ts';
import {
  catalogueBlock,
  directorCatalogueBlock,
  GENERATOR_ANCHOR_NOTE,
  GENERATOR_ASSETS_NOTE,
  generatorCatalogueBlock,
} from './prompt-block.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

/** JSON lines of one closed-list section of the block. */
function jsonIds(block: string, title: string): string[] {
  const body = block.split(`## ${title} `)[1]?.split('\n\n')[0] ?? '';
  return body
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => (JSON.parse(line) as { id: string }).id);
}

describe('catalogueBlock', () => {
  it('is deterministic', () => {
    expect(catalogueBlock()).toBe(catalogueBlock());
  });

  it('does not depend on registry insertion order', () => {
    const primitives = buildPrimitiveRegistry([...PRIMITIVE_DEFINITIONS].reverse());
    const reversed: Registries = {
      ...DEFAULT_REGISTRIES,
      primitives,
      patterns: buildPatternRegistry([...PATTERN_DEFINITIONS].reverse(), primitives),
    };
    expect(catalogueBlock(reversed)).toBe(catalogueBlock());
  });

  it('starts with the story catalogues, then every primitive and pattern once', () => {
    const block = catalogueBlock();
    const { primitives, patterns } = buildCatalogue();
    expect(block.startsWith(`${renderStoryCatalogues()}\n\n## PRIMITIVES `)).toBe(true);
    expect(jsonIds(block, 'PRIMITIVES')).toEqual(primitives.map((p) => p.id));
    expect(jsonIds(block, 'PATTERNS')).toEqual(patterns.map((p) => p.id));
  });

  it('leaves assets out (the Generator gets a per-beat list)', () => {
    expect(catalogueBlock()).not.toMatch(/ASSETS/);
  });
});

/** Estimated tokens at 4 characters each, as the source budget counts them. */
const estimatedTokens = (text: string) => Math.ceil(text.length / 4);

/** The Director's block stays small: summaries only (about 10k tokens). */
const DIRECTOR_BLOCK_TOKEN_BUDGET = 12_000;

describe('directorCatalogueBlock', () => {
  it('is deterministic and independent of registry insertion order', () => {
    const primitives = buildPrimitiveRegistry([...PRIMITIVE_DEFINITIONS].reverse());
    const reversed: Registries = {
      ...DEFAULT_REGISTRIES,
      primitives,
      patterns: buildPatternRegistry([...PATTERN_DEFINITIONS].reverse(), primitives),
    };
    expect(directorCatalogueBlock(reversed)).toBe(directorCatalogueBlock());
  });

  it('lists every primitive and pattern once, after the story catalogues', () => {
    const block = directorCatalogueBlock();
    const { primitives, patterns } = buildCatalogue();
    expect(block.startsWith(`${renderStoryCatalogues()}\n\n## PRIMITIVES `)).toBe(true);
    expect(jsonIds(block, 'PRIMITIVES')).toEqual(primitives.map((p) => p.id));
    expect(jsonIds(block, 'PATTERNS')).toEqual(patterns.map((p) => p.id));
  });

  it('carries summaries only: no props, params or examples', () => {
    const block = directorCatalogueBlock();
    expect(block).not.toMatch(/"(props|params|example|targets)":/);
    expect(block).toContain('"layoutMode":');
    expect(block).toContain('"anchors":');
  });

  it(`stays under ${DIRECTOR_BLOCK_TOKEN_BUDGET} estimated tokens`, () => {
    const tokens = estimatedTokens(directorCatalogueBlock());
    expect(tokens).toBeLessThan(DIRECTOR_BLOCK_TOKEN_BUDGET);
    expect(tokens).toBeLessThan(estimatedTokens(catalogueBlock()) / 2);
  });
});

/** Lines of one closed-list section of a block (heading and note excluded). */
function sectionLines(block: string, title: string): string[] {
  return (block.split(`## ${title} `)[1]?.split('\n\n')[0] ?? '').split('\n').slice(1);
}

/** Every primitive, pattern and asset registered in reverse order. */
function reversedRegistries(): Registries {
  const primitives = buildPrimitiveRegistry([...PRIMITIVE_DEFINITIONS].reverse());
  return {
    primitives,
    patterns: buildPatternRegistry([...PATTERN_DEFINITIONS].reverse(), primitives),
    assets: buildAssetRegistry([...SEED_REGISTRY.values()].reverse()),
  };
}

/**
 * Estimated tokens of compact JSON-heavy text: 3.5 characters each. Calibrated on the recorded
 * agent answers (3.75-4.1 for pretty-printed JSON; compact JSON Schema packs more per token).
 */
const jsonTokens = (text: string) => Math.ceil(text.length / 3.5);

/** The Generator's block stays well under the full one (about 43k tokens). */
const GENERATOR_BLOCK_TOKEN_BUDGET = 35_000;

describe('generatorCatalogueBlock', () => {
  const block = generatorCatalogueBlock();

  it('is deterministic and independent of registry insertion order (assets included)', () => {
    expect(generatorCatalogueBlock()).toBe(block);
    expect(generatorCatalogueBlock(reversedRegistries())).toBe(block);
  });

  it('starts with the layout modes alone: no devices, topic classes or metaphor worlds', () => {
    expect(block.startsWith(`${renderLayoutModeCatalogue()}\n\n## PRIMITIVES `)).toBe(true);
    expect(block).toContain('CATALOGUE VERSIONS: layout-modes@v');
    expect(block).not.toMatch(/NARRATIVE DEVICES|TOPIC CLASSES|METAPHOR WORLDS|topic-classes@/);
  });

  it('lists every primitive as the full block does, and every pattern once', () => {
    const { patterns } = buildCatalogue();
    expect(sectionLines(block, 'PRIMITIVES')).toEqual(sectionLines(catalogueBlock(), 'PRIMITIVES'));
    expect(jsonIds(block, 'PATTERNS')).toEqual(patterns.map((p) => p.id));
  });

  it("states the anchor shape once and points each pattern's params.at at its anchors", () => {
    expect(block.split(GENERATOR_ANCHOR_NOTE)).toHaveLength(2);
    expect(block).not.toMatch(/word_text|"offsetSec"|"const":"word"/);
    const { patterns } = buildCatalogue();
    for (const line of sectionLines(block, 'PATTERNS').filter((l) => l.startsWith('{'))) {
      const entry = JSON.parse(line) as {
        id: string;
        anchors: { name: string }[];
        params: { properties: { at: { type: string; properties?: unknown } } };
      };
      const source = patterns.find((p) => p.id === entry.id);
      expect(entry.anchors).toEqual(source?.anchors);
      expect(entry.params.properties.at.type).toBe('object');
      expect(entry.params.properties.at.properties).toBeUndefined();
    }
  });

  it('ends with how to read the per-beat assets and the families, never an asset id', () => {
    const lines = sectionLines(block, 'ASSET FAMILIES').filter((l) => l.startsWith('- '));
    expect(lines).toEqual(ASSET_FAMILIES.map((f) => `- ${f}`));
    expect(block).toContain(GENERATOR_ASSETS_NOTE);
    expect(block.endsWith(lines.at(-1) ?? '')).toBe(true);
    expect(block).not.toContain('- server (infra)');
  });

  it('does not change with the asset library (it sits in the cached prefix)', () => {
    const tiny = {
      ...DEFAULT_REGISTRIES,
      assets: buildAssetRegistry([...SEED_REGISTRY.values()].slice(0, 3)),
    };
    expect(generatorCatalogueBlock(tiny)).toBe(block);
  });

  it(`stays under ${GENERATOR_BLOCK_TOKEN_BUDGET} estimated tokens (size snapshot)`, async () => {
    const sections = Object.fromEntries(
      block.split(/\n\n(?=## )/).map((part) => {
        const title = /^## ([A-Z ]+) \(/.exec(part)?.[1] ?? 'CATALOGUE VERSIONS';
        return [title, { chars: part.length, tokens: jsonTokens(part) }];
      }),
    );
    const size = { chars: block.length, tokens: jsonTokens(block), sections };
    expect(size.tokens).toBeLessThan(GENERATOR_BLOCK_TOKEN_BUDGET);
    expect(size.tokens).toBeLessThan(jsonTokens(catalogueBlock()));
    await expect(`${JSON.stringify(size, null, 2)}\n`).toMatchFileSnapshot(
      './__snapshots__/generator-catalogue-size.json',
    );
  });
});

describe('catalogue cross-references', () => {
  it('lets every topic class use the default layout mode', () => {
    for (const topicClass of TOPIC_CLASS_CATALOGUE.entries) {
      expect(topicClass.allowedLayoutModes).toContain(DEFAULT_LAYOUT_MODE);
    }
  });

  it("allows every pattern's layout mode in at least one topic class", () => {
    const allowed = new Set(TOPIC_CLASS_CATALOGUE.entries.flatMap((c) => c.allowedLayoutModes));
    const orphans = [...PATTERNS.values()].filter((p) => !allowed.has(p.layoutMode));
    expect(orphans.map((p) => p.id)).toEqual([]);
  });

  it('uses only catalogue devices and metaphor worlds in fixture specs', () => {
    for (const spec of allFixtureSpecs) {
      const devices = [
        ...spec.story.devices,
        ...spec.story.beats.flatMap((b) => (b.device ? [b.device] : [])),
      ];
      for (const device of devices) expect(DEVICE_IDS).toContain(device);
      if (spec.story.metaphorWorld) expect(METAPHOR_WORLD_IDS).toContain(spec.story.metaphorWorld);
    }
  });

  it("keeps golden fixtures' boards within their topic class's layout modes", () => {
    for (const { spec } of goldenFixtures) {
      const topicClass = TOPIC_CLASS_CATALOGUE.entries.find((c) => c.id === spec.meta.topicClass);
      const modes = spec.scenes.map((scene) => beatLayoutMode(scene, PATTERNS));
      const outside = modes.filter((m) => !topicClass?.allowedLayoutModes.includes(m as never));
      expect({ fixture: spec.meta.id, outside }).toEqual({ fixture: spec.meta.id, outside: [] });
    }
  });
});
