import { describe, expect, it } from 'vitest';
import { buildPatternRegistry } from '../patterns/registry.ts';
import { bouncePattern } from '../patterns/test-pattern.ts';
import { buildCatalogue, catalogueJson, catalogueMarkdown } from './catalogue.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

const withPatterns: Registries = {
  ...DEFAULT_REGISTRIES,
  patterns: buildPatternRegistry([bouncePattern]),
};

describe('buildCatalogue', () => {
  it('lists every registered primitive, ordered by family, with LLM-facing fields only', () => {
    const { primitives, patterns } = buildCatalogue();
    expect(primitives.map((p) => p.id)).toEqual([
      'icon',
      'item_icon',
      'node_card',
      'tag',
      'command_bubble',
      'data_block',
      'formula_card',
      'grid_overlay',
      'map_base',
      'route_path',
      'zone_polygon',
      'connector',
      'conveyor_queue',
      'packet_stream',
      'counter',
      'counter_transition',
      'segmented_time_bar',
      'stat_card',
      'timer_ring',
      'slot_grid',
    ]);
    expect(patterns).toEqual([]);
    const tag = primitives.find((p) => p.id === 'tag');
    expect(Object.keys(tag ?? {})).toEqual([
      'id',
      'family',
      'summary',
      'whenToUse',
      'whenNotToUse',
      'actions',
      'props',
      'example',
    ]);
    expect(tag?.props).toMatchObject({
      type: 'object',
      required: ['text'],
      additionalProperties: false,
    });
    expect(tag?.props).not.toHaveProperty('$schema');
    expect(tag?.example).toEqual({
      id: '<example-tag-id>',
      primitive: 'tag',
      props: { text: '<example-label>', semantic: 'problem' },
    });
  });

  it('lists part actions only for primitives with parts', () => {
    const { primitives } = buildCatalogue();
    const slots = primitives.find((p) => p.id === 'slot_grid');
    expect(slots?.partActions).toEqual([
      'enter',
      'exit',
      'lock',
      'highlight',
      'reject',
      'pulse',
      'dim',
    ]);
    expect(primitives.find((p) => p.id === 'connector')).not.toHaveProperty('partActions');
  });

  it('gives prompts the 7-character label cap of queue blocks and slots', () => {
    const { primitives } = buildCatalogue();
    const labelOf = (id: string, list: string) => {
      const props = primitives.find((p) => p.id === id)?.props as {
        properties: Record<string, { items: { properties: { label: unknown } } }>;
      };
      return props.properties[list]?.items.properties.label;
    };
    expect(labelOf('conveyor_queue', 'items')).toMatchObject({ maxLength: 7 });
    expect(labelOf('slot_grid', 'slots')).toMatchObject({ maxLength: 7 });
  });

  it('includes patterns with their narration anchors', () => {
    const [bounce] = buildCatalogue(withPatterns).patterns;
    expect(bounce).toMatchObject({
      id: 'test_bounce',
      anchors: [{ name: 'bounce', description: bouncePattern.anchors[0]?.description }],
      example: { id: '<example-test_bounce-id>', pattern: 'test_bounce' },
    });
  });
});

describe('catalogue files', () => {
  it('JSON round-trips to the catalogue and never carries size hints', () => {
    const json = catalogueJson();
    expect(JSON.parse(json)).toEqual(buildCatalogue());
    expect(json).not.toMatch(/preferredWidth|minWidth/);
  });

  it('markdown documents each primitive, its props and example, and says when no patterns exist', () => {
    const md = catalogueMarkdown();
    expect(md).toContain('### tag');
    expect(md).toContain('### counter');
    expect(md).toContain('| `text` | string | yes |');
    expect(md).toContain('"primitive": "counter"');
    expect(md).toMatch(/\*\*Size hint\*\* \(example, blueprint-dark\): \d+ × \d+ px/);
    expect(md).toContain('No patterns are registered yet.');
    expect(md).toContain('**Part actions** (events with `params.parts`): `enter`, `exit`, `lock`');
    expect(md).toContain(
      '| `slots[].label` | string | yes | Short label on the slot, e.g. a seat number or an item name. (min length 1, max length 7) |',
    );
    expect(md).toMatch(/\| `items\[\]\.label` \| string \| yes \| .*max length 7\) \|/);
  });

  it('markdown documents registered patterns', () => {
    const md = catalogueMarkdown(withPatterns);
    expect(md).toContain('### test_bounce');
    expect(md).toContain('- `bounce`: ');
  });
});
