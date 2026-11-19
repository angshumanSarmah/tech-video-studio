import { describe, expect, it } from 'vitest';
import { buildPatternRegistry } from '../patterns/registry.ts';
import { bouncePattern } from '../patterns/test-pattern.ts';
import { buildCatalogue, catalogueJson, catalogueMarkdown } from './catalogue.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';
import { DEFAULT_THEME_ID } from '../theme/index.ts';

const withPatterns: Registries = {
  ...DEFAULT_REGISTRIES,
  patterns: buildPatternRegistry([bouncePattern]),
};

describe('buildCatalogue', () => {
  it('lists every registered primitive, ordered by family, with LLM-facing fields only', () => {
    const { primitives, patterns } = buildCatalogue();
    expect(primitives.map((p) => p.id)).toEqual([
      'bracket',
      'callout',
      'icon',
      'inset_panel',
      'item_icon',
      'node_card',
      'statement_card',
      'tag',
      'command_bubble',
      'data_block',
      'formula_card',
      'grid_overlay',
      'map_base',
      'radius_ring',
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
      'device_frame',
      'slot_grid',
    ]);
    expect(patterns.map((p) => [p.family, p.id])).toEqual([
      ['annotation', 'versus_split'],
      ['data', 'brute_force_then_index'],
      ['data', 'inference_card'],
      ['spatial', 'pick_by_rule'],
      ['flow', 'atomic_lock'],
      ['flow', 'cache_hit_miss'],
      ['flow', 'converge_adapter'],
      ['flow', 'failover'],
      ['flow', 'fan_out'],
      ['flow', 'flood_then_funnel'],
      ['flow', 'reject_duplicate'],
      ['flow', 'split_brain'],
      ['flow', 'worker_pool'],
    ]);
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

  it('includes patterns with their anchors, layout mode and inner elements', () => {
    const [bounce] = buildCatalogue(withPatterns).patterns;
    expect(bounce).toMatchObject({
      id: 'test_bounce',
      anchors: [{ name: 'bounce', description: bouncePattern.anchors[0]?.description }],
      layoutMode: 'two_column',
      targets: [{ id: 'held' }, { id: 'second' }],
      innerActions: ['highlight', 'pulse', 'dim'],
      example: { id: '<example-test_bounce-id>', pattern: 'test_bounce' },
    });
  });

  it('lists every layout mode with its zones', () => {
    const { layoutModes } = buildCatalogue();
    expect(layoutModes.map((m) => m.id)).toContain('hub_spoke');
    expect(layoutModes.find((m) => m.id === 'versus_split')?.zones).toEqual([
      'left',
      'right',
      'shared',
    ]);
  });
});

describe('catalogue files', () => {
  it('JSON round-trips to the catalogue and never carries size hints', () => {
    const json = catalogueJson();
    expect(JSON.parse(json)).toEqual(buildCatalogue());
    expect(json).not.toMatch(/preferredWidth|minWidth/);
  });

  it('markdown documents each primitive, its props and example', () => {
    const md = catalogueMarkdown();
    expect(md).toContain('### tag');
    expect(md).toContain('### counter');
    expect(md).toContain('| `text` | string | yes |');
    expect(md).toContain('"primitive": "counter"');
    expect(md).toContain(`**Size hint** (example, ${DEFAULT_THEME_ID}): `);
    expect(md).toMatch(/\*\*Size hint\*\* \(example, [a-z-]+\): \d+ × \d+ px/);
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
    expect(md).toContain('**Layout mode:** `two_column`');
    expect(md).toContain('**Inner elements** (target as `<instance>/<id>` with `highlight`');
    expect(md).toContain('- `held`: The held label.');
    expect(md).toContain('| `hub_spoke` | `hub`, `spoke`, `aside` |');
  });
});
