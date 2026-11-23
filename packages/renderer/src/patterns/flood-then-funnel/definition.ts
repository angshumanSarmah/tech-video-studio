import { z } from 'zod';
import { displayNumber, lineText } from '../../primitives/common-props.ts';
import { el, link, nodeParam, nodeProps, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'flood', description: 'The flood of requests starts and the rate counts up.' },
  { name: 'overwhelm', description: 'The target gives way: it shakes red and a warning shows.' },
  {
    name: 'funnel',
    description:
      'The middle layer appears, turns the flood into one steady line, and the target recovers.',
  },
] as const;

export const floodThenFunnelPattern = definePattern({
  id: 'flood_then_funnel',
  family: 'flow',
  layoutMode: 'pipeline',
  paramsSchema: z.strictObject({
    source: nodeParam('Where the flood comes from (clients, users, producers).'),
    target: nodeParam('The node that is overwhelmed (an API, a database).'),
    layer: nodeParam('The middle layer that absorbs the flood (a queue, a rate limiter, a CDN).'),
    rate: z
      .strictObject({
        value: displayNumber(z.number()).int().min(1).describe('Peak rate of the flood.'),
        unit: lineText(16, 'Unit after the number, e.g. req/s.'),
        label: lineText(32, 'Optional caption under the number.').optional(),
      })
      .describe('The flood rate, counted up from 0 as the flood starts.'),
    warning: lineText(24, 'Tag shown when the target gives way.').default('OVERLOADED'),
    at: anchorsSchema(ANCHORS),
  }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  formats: ['full'],
  anchors: ANCHORS,
  targets: [
    { id: 'source', description: 'Where the flood comes from.' },
    { id: 'target', description: 'The overwhelmed node.' },
    { id: 'layer', description: 'The middle layer (enters on the funnel).' },
    { id: 'direct', description: 'The direct arrow from source to target (exits on the funnel).' },
    { id: 'flood', description: 'The dense packet stream on the direct arrow.' },
    { id: 'rate', description: 'The flood rate counter.' },
    { id: 'warning', description: 'The warning tag on the target.' },
    { id: 'in', description: 'Arrow from the source into the layer.' },
    { id: 'in-flow', description: 'The dense stream into the layer.' },
    { id: 'out', description: 'Arrow from the layer to the target.' },
    { id: 'out-flow', description: 'The single steady stream out of the layer.' },
  ],
  description: {
    summary:
      'A dense stream of requests hits a node directly while the rate counts up; the node ' +
      'shakes red and a warning shows. Then a middle layer steps in: the flood goes into it and ' +
      'a single, slow, steady line comes out to the node, which recovers.',
    whenToUse:
      'Failure before the fix for load: a rate limiter, a queue, a cache or a CDN absorbing a ' +
      'spike that would knock a server over.',
    whenNotToUse:
      'Two requests for one resource (use `atomic_lock`); one message copied to many targets ' +
      '(use `fan_out`).',
  },
  example: {
    params: {
      source: { title: '<example-source>', icon: 'users' },
      target: { title: '<example-target>', icon: 'server' },
      layer: { title: '<example-layer>', icon: 'layers' },
      rate: { value: 10000, unit: '<example-unit>' },
      at: {
        flood: { type: 'word', index: 0 },
        overwhelm: { type: 'word', index: 1 },
        funnel: { type: 'word', index: 2 },
      },
    },
  },
  expand: (p) => ({
    elements: [
      el('source', 'node_card', nodeProps(p.source), 'source'),
      el('layer', 'node_card', nodeProps(p.layer, { semantic: 'focus' }), 'stage'),
      el('target', 'node_card', nodeProps(p.target), 'sink'),
      link('direct', 'source', 'target', { semantic: 'problem' }),
      el('flood', 'packet_stream', { along: 'direct', rate: 12, semantic: 'problem' }),
      el(
        'rate',
        'counter',
        {
          value: p.rate.value,
          from: 0,
          unit: p.rate.unit,
          semantic: 'problem',
          ...(p.rate.label ? { label: p.rate.label } : {}),
        },
        'aside',
      ),
      el('warning', 'tag', { text: p.warning, semantic: 'problem' }, 'aside'),
      link('in', 'source', 'layer'),
      el('in-flow', 'packet_stream', { along: 'in', rate: 12 }),
      link('out', 'layer', 'target', { semantic: 'ok' }),
      el('out-flow', 'packet_stream', { along: 'out', rate: 1, semantic: 'ok' }),
    ],
    events: [
      on(p.at.flood, 'enter', ['source', 'target', 'direct', 'flood', 'rate']),
      on(p.at.flood, 'count', ['rate']),
      on(p.at.overwhelm, 'reject', ['target']),
      on(p.at.overwhelm, 'enter', ['warning']),
      on(p.at.overwhelm, 'pulse', ['rate']),
      on(p.at.funnel, 'exit', ['direct', 'flood', 'warning']),
      on(p.at.funnel, 'recover', ['target']),
      on(p.at.funnel, 'enter', ['layer', 'in', 'in-flow', 'out', 'out-flow']),
    ],
  }),
});
