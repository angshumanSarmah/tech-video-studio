import { z } from 'zod';
import { lineText } from '../../primitives/common-props.ts';
import { SLOT_KINDS } from '../../primitives/slot-grid/definition.ts';
import { el, link, nodeParam, nodeProps, nth, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'scan', description: 'Every item is checked one by one and turns red.' },
  { name: 'slow', description: 'The cost of checking everything is named.' },
  { name: 'index', description: 'The index appears.' },
  { name: 'found', description: 'The index jumps straight to the right item.' },
] as const;

export const bruteForceThenIndexPattern = definePattern({
  id: 'brute_force_then_index',
  family: 'data',
  layoutMode: 'centered_focus',
  paramsSchema: z
    .strictObject({
      items: z
        .array(lineText(7, 'Short label of one item, e.g. a zone or a row id.'))
        .min(4)
        .max(12)
        .refine((labels) => new Set(labels).size === labels.length, 'Each label at most once.')
        .describe('The items a brute-force search checks, 4 to 12, in reading order.'),
      kind: z
        .enum(SLOT_KINDS)
        .default('documents')
        .describe('How items look: inventory, shelf, seats or documents.'),
      target: lineText(7, 'Label of the item being looked for; one of items.'),
      cost: lineText(24, 'Tag naming the brute-force cost.').default('CHECK ALL = SLOW'),
      index: nodeParam('The index or lookup structure (a hash map, a B-tree, a grid).'),
      fast: lineText(24, 'Tag naming the indexed cost.').default('ONE LOOKUP'),
      at: anchorsSchema(ANCHORS),
    })
    .refine((p) => p.items.includes(p.target), {
      message: 'The target must be one of items.',
      path: ['target'],
    }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  anchors: ANCHORS,
  targets: [
    { id: 'items', description: 'The items, a slot grid; its slots are parts item-1, item-2, …' },
    { id: 'cost', description: 'The brute-force cost tag.' },
    { id: 'index', description: 'The index.' },
    { id: 'jump', description: 'Arrow from the index to the items.' },
    { id: 'fast', description: 'The indexed cost tag.' },
  ],
  description: {
    summary:
      'A brute-force search checks every item and each turns red, with a tag naming the cost. ' +
      'Then an index appears and jumps straight to the one item, which lights up.',
    whenToUse:
      'Brute force before the clever fix: a full table scan vs an index, checking every zone vs ' +
      'a grid cell lookup, a linear search vs a hash map.',
    whenNotToUse:
      'A fast and a slow store side by side (use `cache_hit_miss`); two whole designs compared ' +
      '(use `versus_split`).',
  },
  example: {
    params: {
      items: ['<ex-1>', '<ex-2>', '<ex-3>', '<ex-4>'],
      target: '<ex-3>',
      index: { title: '<example-index>', icon: 'key' },
      at: {
        scan: { type: 'word', index: 0 },
        slow: { type: 'word', index: 1 },
        index: { type: 'word', index: 2 },
        found: { type: 'word', index: 3 },
      },
    },
  },
  expand: (p) => {
    const ids = p.items.map((_, i) => nth('item', i));
    const target = nth('item', p.items.indexOf(p.target));
    const others = ids.filter((id) => id !== target);
    return {
      elements: [
        el(
          'items',
          'slot_grid',
          { kind: p.kind, slots: p.items.map((label, i) => ({ id: nth('item', i), label })) },
          'center',
        ),
        el('cost', 'tag', { text: p.cost, semantic: 'problem' }, 'aside'),
        el('index', 'node_card', nodeProps(p.index, { semantic: 'concept' }), 'around'),
        link('jump', 'index', 'items', { semantic: 'focus' }),
        el('fast', 'tag', { text: p.fast, semantic: 'ok' }, 'aside'),
      ],
      events: [
        on(p.at.scan, 'enter', ['items']),
        on(p.at.scan, 'reject', ['items'], others),
        on(p.at.scan, 'pulse', ['items'], [target]),
        on(p.at.slow, 'enter', ['cost']),
        on(p.at.slow, 'pulse', ['cost']),
        on(p.at.index, 'enter', ['index']),
        on(p.at.index, 'dim', ['items'], others),
        on(p.at.index, 'dim', ['cost']),
        on(p.at.found, 'enter', ['jump', 'fast']),
        on(p.at.found, 'move', ['jump']),
        on(p.at.found, 'highlight', ['items'], [target]),
      ],
    };
  },
});
