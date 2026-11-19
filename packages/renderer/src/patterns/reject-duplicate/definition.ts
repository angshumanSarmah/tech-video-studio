import { z } from 'zod';
import { lineText } from '../../primitives/common-props.ts';
import { el, link, nodeParam, nodeProps, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'first', description: 'The request arrives the first time and is processed.' },
  { name: 'second', description: 'The same request (same id) arrives again.' },
  { name: 'stamp', description: 'The repeat is recognised and stamped as a duplicate.' },
] as const;

export const rejectDuplicatePattern = definePattern({
  id: 'reject_duplicate',
  family: 'flow',
  layoutMode: 'pipeline',
  paramsSchema: z.strictObject({
    sender: nodeParam('Who sends the request (a client retrying, a producer).'),
    receiver: nodeParam('Who checks the id and processes the request once.'),
    key: lineText(24, 'The id both copies carry, as shown, e.g. order_id 7781.'),
    stamp: lineText(16, 'Stamp on the repeat.').default('DUPLICATE'),
    at: anchorsSchema(ANCHORS),
  }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  formats: ['full'],
  anchors: ANCHORS,
  targets: [
    { id: 'sender', description: 'The sender.' },
    { id: 'receiver', description: 'The receiver that dedupes.' },
    { id: 'link', description: 'Arrow from sender to receiver; a packet travels on each arrival.' },
    { id: 'first', description: 'The first copy of the id (accepted).' },
    { id: 'second', description: 'The second copy (rejected).' },
    { id: 'duplicate', description: 'The stamp on the second copy.' },
  ],
  description: {
    summary:
      'The same request arrives twice. The first copy travels to the receiver and is accepted; ' +
      'the second, carrying the same id, is turned red and stamped DUPLICATE, so the work ' +
      'happens once.',
    whenToUse:
      'Idempotency and deduplication: a payment retried after a timeout, a message delivered ' +
      'twice, a double-clicked submit.',
    whenNotToUse:
      'Two different requests competing for one resource (use `atomic_lock`); a request that ' +
      'fails for another reason (use a `tag` or `callout`).',
  },
  example: {
    params: {
      sender: { title: '<example-sender>', icon: 'smartphone' },
      receiver: { title: '<example-receiver>', icon: 'server' },
      key: '<example-key>',
      at: {
        first: { type: 'word', index: 0 },
        second: { type: 'word', index: 1 },
        stamp: { type: 'word', index: 2 },
      },
    },
  },
  expand: (p) => ({
    elements: [
      el('sender', 'node_card', nodeProps(p.sender), 'source'),
      el('first', 'tag', { text: p.key, semantic: 'ok' }, 'stage'),
      el('second', 'tag', { text: p.key }, 'stage'),
      el('receiver', 'node_card', nodeProps(p.receiver), 'sink'),
      link('link', 'sender', 'receiver'),
      el('duplicate', 'tag', { text: p.stamp, semantic: 'problem' }, 'aside'),
    ],
    events: [
      on(p.at.first, 'enter', ['sender', 'receiver', 'link', 'first']),
      on(p.at.first, 'move', ['link']),
      on(p.at.second, 'enter', ['second']),
      on(p.at.second, 'move', ['link']),
      on(p.at.stamp, 'reject', ['second']),
      on(p.at.stamp, 'enter', ['duplicate']),
      on(p.at.stamp, 'pulse', ['receiver']),
    ],
  }),
});
