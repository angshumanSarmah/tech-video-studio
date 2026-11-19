import type { EventAnchor } from '@explainer-studio/shared';
import { z } from 'zod';
import { AssetIdSchema, lineText } from '../../primitives/common-props.ts';
import { el, link, nodeProps, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'show', description: 'Both sides appear.' },
  { name: 'event', description: 'The same event reaches both sides at once.' },
  { name: 'verdict', description: 'Each side shows how it handled it.' },
] as const;

const SideSchema = z.strictObject({
  title: lineText(24, 'Name of this side (a design, a system, a setting).'),
  icon: AssetIdSchema.optional(),
  verdict: lineText(24, 'What happens on this side, as a short tag, e.g. 2 MS or DATA LOST.'),
  outcome: z
    .enum(['ok', 'problem'])
    .describe('ok (handles it: the side lights up) or problem (fails: the side turns red).'),
});
type Side = z.output<typeof SideSchema>;

export const versusSplitPattern = definePattern({
  id: 'versus_split',
  family: 'annotation',
  layoutMode: 'versus_split',
  paramsSchema: z.strictObject({
    event: lineText(24, 'The one event both sides get, as a short tag, e.g. 10K WRITES.'),
    left: SideSchema.describe('The left side.'),
    right: SideSchema.describe('The right side.'),
    at: anchorsSchema(ANCHORS),
  }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  formats: ['full', 'card'],
  anchors: ANCHORS,
  targets: [
    { id: 'event', description: 'The shared event tag.' },
    { id: 'left', description: 'The left side.' },
    { id: 'right', description: 'The right side.' },
    { id: 'left-link', description: 'Arrow from the event to the left side.' },
    { id: 'right-link', description: 'Arrow from the event to the right side.' },
    { id: 'left-verdict', description: 'The verdict tag on the left.' },
    { id: 'right-verdict', description: 'The verdict tag on the right.' },
  ],
  description: {
    summary:
      'Two halves side by side get the same event at the same moment, and each shows its own ' +
      'outcome: the side that handles it lights up with its verdict, the side that fails turns ' +
      'red.',
    whenToUse:
      'Comparing two designs under one condition: SQL vs NoSQL under a write burst, sync vs ' +
      'async on a slow call, temperature 0 vs 1 on one prompt.',
    whenNotToUse:
      'A near and a far store (use `cache_hit_miss`); a slow way then a fast way in sequence ' +
      '(use `brute_force_then_index`).',
  },
  example: {
    params: {
      event: '<example-event>',
      left: { title: '<example-left>', verdict: '<example-verdict>', outcome: 'ok' },
      right: { title: '<example-right>', verdict: '<example-verdict>', outcome: 'problem' },
      at: {
        show: { type: 'word', index: 0 },
        event: { type: 'word', index: 1 },
        verdict: { type: 'word', index: 2 },
      },
    },
  },
  expand: (p) => ({
    elements: [
      el('event', 'tag', { text: p.event, semantic: 'focus' }, 'shared'),
      el('left', 'node_card', nodeProps(p.left), 'left'),
      el('right', 'node_card', nodeProps(p.right), 'right'),
      link('left-link', 'event', 'left'),
      link('right-link', 'event', 'right'),
      el('left-verdict', 'tag', { text: p.left.verdict, semantic: p.left.outcome }, 'left'),
      el('right-verdict', 'tag', { text: p.right.verdict, semantic: p.right.outcome }, 'right'),
    ],
    events: [
      on(p.at.show, 'enter', ['left', 'right']),
      on(p.at.event, 'enter', ['event', 'left-link', 'right-link']),
      on(p.at.event, 'move', ['left-link', 'right-link']),
      on(p.at.verdict, 'enter', ['left-verdict', 'right-verdict']),
      ...outcomeEvents(p.at.verdict, 'left', p.left),
      ...outcomeEvents(p.at.verdict, 'right', p.right),
    ],
  }),
});

/** The verdict word lights a side that copes and rejects a side that fails. */
function outcomeEvents(verdict: EventAnchor, id: string, side: Side) {
  return side.outcome === 'ok'
    ? [on(verdict, 'highlight', [id])]
    : [on(verdict, 'reject', [id, `${id}-verdict`])];
}
