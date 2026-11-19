import { z } from 'zod';
import { lineText } from '../../primitives/common-props.ts';
import { el, link, nodeParam, nodeProps, nth, numbered, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'send', description: 'The source sends the one message.' },
  { name: 'split', description: 'The message is copied to every target.' },
  { name: 'crowd', description: 'The copies reach the crowd behind the targets.' },
] as const;

export const fanOutPattern = definePattern({
  id: 'fan_out',
  family: 'flow',
  layoutMode: 'pipeline',
  paramsSchema: z.strictObject({
    source: nodeParam('Where the message starts (a publisher, a post, a broker).'),
    message: lineText(24, 'The message, as a short tag, e.g. NEW POST.'),
    targets: z
      .array(nodeParam('One target that receives a copy.'))
      .min(2)
      .max(4)
      .describe('The targets the message splits to, 2 to 4.'),
    crowd: z
      .strictObject({
        value: z.number().int().min(1).describe('How many end receivers there are.'),
        unit: lineText(16, 'Optional unit after the number.').optional(),
        label: lineText(32, 'What the crowd is, e.g. FOLLOWERS.'),
      })
      .describe('The crowd the targets deliver to, counted up as copies reach it.'),
    at: anchorsSchema(ANCHORS),
  }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  anchors: ANCHORS,
  targets: [
    { id: 'source', description: 'The source.' },
    { id: 'message', description: 'The message tag at the source.' },
    { id: 'target-<n>', description: 'The n-th target (from 1).' },
    { id: 'link-<n>', description: 'Arrow from the source to the n-th target.' },
    { id: 'reach-<n>', description: 'Arrow from the n-th target to the crowd.' },
    { id: 'crowd', description: 'The crowd counter.' },
  ],
  description: {
    summary:
      'One message leaves a source and splits into a copy per target (a packet on each arrow), ' +
      'then the targets pass it on to a crowd whose count climbs.',
    whenToUse:
      'Fan-out and pub/sub: one post reaching every follower, one event delivered to several ' +
      'services, a broadcast through regional servers.',
    whenNotToUse:
      'Many inputs merging into one (use `converge_adapter`); work shared out from a queue ' +
      '(use `worker_pool`).',
  },
  example: {
    params: {
      source: { title: '<example-source>', icon: 'mail' },
      message: '<example-message>',
      targets: [{ title: '<example-target-1>' }, { title: '<example-target-2>' }],
      crowd: { value: 100000, label: '<example-crowd>' },
      at: {
        send: { type: 'word', index: 0 },
        split: { type: 'word', index: 1 },
        crowd: { type: 'word', index: 2 },
      },
    },
  },
  expand: (p) => {
    const targets = numbered('target', p.targets.length);
    const links = numbered('link', p.targets.length);
    const reaches = numbered('reach', p.targets.length);
    return {
      elements: [
        el('source', 'node_card', nodeProps(p.source), 'source'),
        el('message', 'tag', { text: p.message, semantic: 'focus' }, 'source'),
        ...p.targets.map((t, i) => el(nth('target', i), 'node_card', nodeProps(t), 'stage')),
        ...targets.map((t, i) => link(nth('link', i), 'source', t)),
        el(
          'crowd',
          'counter',
          { value: p.crowd.value, from: 0, label: p.crowd.label, ...unit(p.crowd.unit) },
          'sink',
        ),
        ...targets.map((t, i) => link(nth('reach', i), t, 'crowd', { semantic: 'concept' })),
      ],
      events: [
        on(p.at.send, 'enter', ['source', 'message']),
        on(p.at.send, 'pulse', ['message']),
        on(p.at.split, 'enter', [...targets, ...links]),
        on(p.at.split, 'move', links),
        on(p.at.crowd, 'enter', ['crowd', ...reaches]),
        on(p.at.crowd, 'move', reaches),
        on(p.at.crowd, 'count', ['crowd']),
      ],
    };
  },
});

function unit(value: string | undefined) {
  return value ? { unit: value } : {};
}
