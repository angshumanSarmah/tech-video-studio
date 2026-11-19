import { z } from 'zod';
import { lineText } from '../../primitives/common-props.ts';
import { el, link, nodeParam, nodeProps, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'show', description: 'The client, the near store and the far store appear.' },
  { name: 'hit', description: 'A request is answered by the near store (fast).' },
  {
    name: 'miss',
    description: 'A request misses the near store and goes on to the far one (slow).',
  },
] as const;

const latency = (what: string) => lineText(12, `Latency of a ${what}, e.g. 2 ms.`);

export const cacheHitMissPattern = definePattern({
  id: 'cache_hit_miss',
  family: 'flow',
  layoutMode: 'near_far',
  paramsSchema: z.strictObject({
    client: nodeParam('Who asks (a user, an app server).'),
    near: nodeParam('The near, fast store (a cache, an edge server).'),
    far: nodeParam('The far, slow store (a database, the origin).'),
    hitLatency: latency('hit'),
    missLatency: latency('miss'),
    at: anchorsSchema(ANCHORS),
  }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  formats: ['full'],
  anchors: ANCHORS,
  targets: [
    { id: 'client', description: 'The client.' },
    { id: 'near', description: 'The near store.' },
    { id: 'far', description: 'The far store.' },
    { id: 'near-link', description: 'Arrow from the client to the near store.' },
    { id: 'far-link', description: 'Arrow from the near store to the far store (the miss path).' },
    { id: 'hit', description: 'The HIT tag with its latency.' },
    { id: 'miss', description: 'The MISS tag with its latency.' },
  ],
  description: {
    summary:
      'A client with a near store and a far store. A hit is answered by the near store and ' +
      'tagged with its small latency; a miss goes on to the far store and is tagged with its ' +
      'large one, so the gap in latency is the lesson.',
    whenToUse:
      'Caching, CDNs and any near/far trade-off: cache vs database, edge vs origin, memory vs ' +
      'disk, KV cache vs recomputation.',
    whenNotToUse:
      'Comparing two whole designs side by side (use `versus_split`); a flood of requests on one ' +
      'node (use `flood_then_funnel`).',
  },
  example: {
    params: {
      client: { title: '<example-client>', icon: 'user' },
      near: { title: '<example-near>', icon: 'zap' },
      far: { title: '<example-far>', icon: 'database' },
      hitLatency: '<example-ms>',
      missLatency: '<example-ms>',
      at: {
        show: { type: 'word', index: 0 },
        hit: { type: 'word', index: 1 },
        miss: { type: 'word', index: 2 },
      },
    },
  },
  expand: (p) => ({
    elements: [
      el('client', 'node_card', nodeProps(p.client), 'origin'),
      el('near', 'node_card', nodeProps(p.near, { semantic: 'ok' }), 'near'),
      el('far', 'node_card', nodeProps(p.far), 'far'),
      link('near-link', 'client', 'near', { heads: 'both' }),
      link('far-link', 'near', 'far', { heads: 'both', semantic: 'problem' }),
      el('hit', 'tag', {
        text: `HIT · ${p.hitLatency}`,
        semantic: 'ok',
        pin: { to: 'near-link', side: 'middle' },
      }),
      el('miss', 'tag', {
        text: `MISS · ${p.missLatency}`,
        semantic: 'problem',
        pin: { to: 'far-link', side: 'middle' },
      }),
    ],
    events: [
      on(p.at.show, 'enter', ['client', 'near', 'far', 'near-link']),
      on(p.at.hit, 'move', ['near-link']),
      on(p.at.hit, 'enter', ['hit']),
      on(p.at.hit, 'pulse', ['near']),
      on(p.at.miss, 'move', ['near-link']),
      on(p.at.miss, 'enter', ['far-link', 'miss']),
      on(p.at.miss, 'move', ['far-link']),
      on(p.at.miss, 'pulse', ['far']),
    ],
  }),
});
