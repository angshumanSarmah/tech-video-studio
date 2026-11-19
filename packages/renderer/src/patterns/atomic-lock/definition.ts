import { z } from 'zod';
import { lineText } from '../../primitives/common-props.ts';
import { TIMER_MAX_SEC } from '../../primitives/timer-ring/definition.ts';
import { el, link, nodeParam, nodeProps, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'arrive', description: 'The first request reaches the resource.' },
  { name: 'lock', description: 'The resource is locked and the hold timer starts.' },
  { name: 'second', description: 'A second request arrives for the same resource.' },
  { name: 'bounce', description: 'The second request is turned away.' },
] as const;

export const atomicLockPattern = definePattern({
  id: 'atomic_lock',
  family: 'flow',
  layoutMode: 'hub_spoke',
  paramsSchema: z.strictObject({
    resource: nodeParam('The one thing both requests want (a room, a row, a slot).'),
    first: nodeParam('The request that gets there first.'),
    second: nodeParam('The request that arrives while the lock is held.'),
    holdSec: z
      .number()
      .int()
      .min(1)
      .max(TIMER_MAX_SEC)
      .describe('How long the lock holds, in seconds (the hold timer starts here).'),
    holdLabel: lineText(24, 'Optional caption under the hold timer.').optional(),
    bounce: lineText(24, 'Tag on the turned-away request, e.g. ALREADY HELD.').default('LOCKED'),
    at: anchorsSchema(ANCHORS),
  }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  formats: ['full'],
  anchors: ANCHORS,
  targets: [
    { id: 'resource', description: 'The locked resource.' },
    { id: 'first', description: 'The request that holds the lock.' },
    { id: 'second', description: 'The request that bounces.' },
    { id: 'first-link', description: 'Arrow from the first request to the resource.' },
    { id: 'second-link', description: 'Arrow from the second request (rejected on bounce).' },
    { id: 'hold', description: 'The hold timer.' },
    { id: 'bounced', description: 'The tag on the turned-away request.' },
  ],
  description: {
    summary:
      'Two requests race for one resource. The first arrives and locks it (padlock) and a hold ' +
      'timer starts; the second arrives while it is held, its arrow turns red and it is tagged ' +
      'with a cross.',
    whenToUse:
      'Contention for one thing: two users booking the same room, two workers claiming the same ' +
      'job, two writers on one row. The moment the lock makes the second attempt fail.',
    whenNotToUse:
      'Rejecting a repeat of the same request (use `reject_duplicate`); many requests ' +
      'overwhelming a server (use `flood_then_funnel`).',
  },
  example: {
    params: {
      resource: { title: '<example-resource>', icon: 'lock' },
      first: { title: '<example-first>', icon: 'user' },
      second: { title: '<example-second>', icon: 'user' },
      holdSec: 600,
      holdLabel: '<example-hold>',
      bounce: '<example-bounce>',
      at: {
        arrive: { type: 'word', index: 0 },
        lock: { type: 'word', index: 1 },
        second: { type: 'word', index: 2 },
        bounce: { type: 'word', index: 3 },
      },
    },
  },
  expand: (p) => ({
    elements: [
      el('first', 'node_card', nodeProps(p.first), 'spoke'),
      el('resource', 'node_card', nodeProps(p.resource), 'hub'),
      el('second', 'node_card', nodeProps(p.second), 'spoke'),
      link('first-link', 'first', 'resource', { semantic: 'focus' }),
      link('second-link', 'second', 'resource'),
      el('hold', 'timer_ring', {
        durationSec: p.holdSec,
        ...(p.holdLabel ? { label: p.holdLabel } : {}),
        pin: { to: 'resource', side: 'right' },
      }),
      el('bounced', 'tag', {
        text: p.bounce,
        semantic: 'problem',
        pin: { to: 'second', side: 'bottom' },
      }),
    ],
    events: [
      on(p.at.arrive, 'enter', ['first', 'resource', 'first-link']),
      on(p.at.arrive, 'move', ['first-link']),
      on(p.at.lock, 'lock', ['resource']),
      on(p.at.lock, 'enter', ['hold']),
      on(p.at.lock, 'count', ['hold']),
      on(p.at.second, 'enter', ['second', 'second-link']),
      on(p.at.second, 'move', ['second-link']),
      on(p.at.bounce, 'reject', ['second-link', 'second']),
      on(p.at.bounce, 'enter', ['bounced']),
      on(p.at.bounce, 'reject', ['bounced']),
    ],
  }),
});
