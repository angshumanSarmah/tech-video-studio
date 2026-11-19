import { SpecIdSchema } from '@explainer-studio/shared';
import { z } from 'zod';
import { AssetIdSchema, lineText } from '../../primitives/common-props.ts';
import { NODE_SUBTITLE_MAX } from '../../primitives/node-card/definition.ts';
import { el, link, nodeParam, nodeProps, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'show', description: 'The target and the candidates around it appear.' },
  { name: 'obvious', description: 'The obvious pick is named (nearest, first, cheapest).' },
  { name: 'cross', description: 'The obvious pick is crossed out.' },
  { name: 'pick', description: 'The right pick is ringed with the reason it wins.' },
] as const;

const CandidateSchema = z.strictObject({
  id: SpecIdSchema.describe('Short slug for this candidate, used by obvious and pick.'),
  title: lineText(24, 'Name of the candidate, e.g. SERVER 2.'),
  detail: lineText(
    NODE_SUBTITLE_MAX,
    'Optional detail under the name, e.g. 12 MS AWAY.',
  ).optional(),
  icon: AssetIdSchema.optional(),
});

const ChoiceSchema = (what: string, max: number) =>
  z.strictObject({
    candidate: SpecIdSchema.describe(`Id of the ${what} candidate.`),
    reason: lineText(max, `Tag on the ${what} pick: why it looks right or wins.`),
  });

export const pickByRulePattern = definePattern({
  id: 'pick_by_rule',
  family: 'spatial',
  layoutMode: 'hub_spoke',
  paramsSchema: z
    .strictObject({
      target: nodeParam('What is being matched (an order, a request, a key).'),
      radius: lineText(
        16,
        'Optional label of a search ring around the target, e.g. 2 KM.',
      ).optional(),
      candidates: z
        .array(CandidateSchema)
        .min(3)
        .max(5)
        .refine((c) => new Set(c.map((x) => x.id)).size === c.length, 'Each id at most once.')
        .describe('The candidates around the target, 3 to 5.'),
      obvious: ChoiceSchema('obvious', 24).describe('The tempting pick that is wrong.'),
      pick: ChoiceSchema('right', 32).describe('The pick the rule chooses, with its reason.'),
      at: anchorsSchema(ANCHORS),
    })
    .superRefine((p, ctx) => {
      const ids = p.candidates.map((c) => c.id);
      for (const key of ['obvious', 'pick'] as const) {
        if (!ids.includes(p[key].candidate)) {
          ctx.addIssue({
            code: 'custom',
            path: [key, 'candidate'],
            message: `Not a candidate id. Candidates: ${ids.join(', ')}.`,
          });
        }
      }
      if (p.obvious.candidate === p.pick.candidate) {
        ctx.addIssue({
          code: 'custom',
          path: ['pick', 'candidate'],
          message: 'The right pick must differ from the obvious one.',
        });
      }
    }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  formats: ['full'],
  anchors: ANCHORS,
  targets: [
    { id: 'target', description: 'The target.' },
    { id: 'ring', description: 'The search ring (with radius).' },
    { id: 'candidate-<id>', description: 'The candidate with that id.' },
    { id: 'obvious-tag', description: 'The tag on the obvious pick.' },
    { id: 'pick-tag', description: 'The reason tag on the right pick.' },
    { id: 'pick-link', description: 'Arrow from the right pick to the target.' },
  ],
  description: {
    summary:
      'Candidates around a target, optionally inside a search ring that encloses them. The ' +
      'obvious pick (nearest, ' +
      'first, cheapest) gets a tag and is crossed out; the right one is ringed, linked to the ' +
      'target and tagged with the rule that makes it win ("FREE + 12 MS").',
    whenToUse:
      'Matching and scheduling decisions where the naive rule is wrong: couriers to parcels, ' +
      'servers to requests, cache nodes to keys, workers to jobs.',
    whenNotToUse:
      'A prediction from features (use `inference_card`); two designs compared (use ' +
      '`versus_split`).',
  },
  example: {
    params: {
      target: { title: '<example-target>', icon: 'package' },
      radius: '<example-km>',
      candidates: [
        { id: 'example-a', title: '<example-a>', detail: '<example-detail>' },
        { id: 'example-b', title: '<example-b>' },
        { id: 'example-c', title: '<example-c>' },
      ],
      obvious: { candidate: 'example-a', reason: '<example-nearest>' },
      pick: { candidate: 'example-b', reason: '<example-reason>' },
      at: {
        show: { type: 'word', index: 0 },
        obvious: { type: 'word', index: 1 },
        cross: { type: 'word', index: 2 },
        pick: { type: 'word', index: 3 },
      },
    },
  },
  expand: (p) => {
    const candidate = (id: string) => `candidate-${id}`;
    const obvious = candidate(p.obvious.candidate);
    const pick = candidate(p.pick.candidate);
    return {
      elements: [
        el('target', 'node_card', nodeProps(p.target, { semantic: 'focus' }), 'hub'),
        ...(p.radius
          ? [
              el('ring', 'radius_ring', {
                around: 'target',
                encloses: p.candidates.map((c) => candidate(c.id)),
                label: p.radius,
              }),
            ]
          : []),
        ...p.candidates.map((c) =>
          el(
            candidate(c.id),
            'node_card',
            { ...nodeProps(c), ...(c.detail ? { subtitle: c.detail } : {}) },
            'spoke',
          ),
        ),
        el('obvious-tag', 'tag', {
          text: p.obvious.reason,
          semantic: 'focus',
          pin: { to: obvious, side: 'top' },
        }),
        el('pick-tag', 'tag', {
          text: p.pick.reason,
          semantic: 'ok',
          pin: { to: pick, side: 'top' },
        }),
        link('pick-link', pick, 'target', { semantic: 'ok' }),
      ],
      events: [
        on(p.at.show, 'enter', [
          'target',
          ...(p.radius ? ['ring'] : []),
          ...p.candidates.map((c) => candidate(c.id)),
        ]),
        on(p.at.obvious, 'enter', ['obvious-tag']),
        on(p.at.obvious, 'highlight', [obvious]),
        on(p.at.cross, 'reject', [obvious, 'obvious-tag']),
        on(p.at.pick, 'highlight', [pick]),
        on(p.at.pick, 'enter', ['pick-tag', 'pick-link']),
        on(p.at.pick, 'move', ['pick-link']),
      ],
    };
  },
});
