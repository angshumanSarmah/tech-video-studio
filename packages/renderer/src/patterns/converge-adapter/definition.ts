import type { SemanticColour } from '../../theme/index.ts';
import { z } from 'zod';
import { lineText } from '../../primitives/common-props.ts';
import { el, link, nodeParam, nodeProps, nth, numbered, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'inputs', description: 'The differently shaped inputs appear.' },
  { name: 'convert', description: 'The hub appears and each input flows into it.' },
  { name: 'output', description: 'One uniform output leaves the hub.' },
] as const;

/** Inputs are told apart by colour: each gets the next of these, so no two look alike. */
const INPUT_STYLES: readonly SemanticColour[] = ['concept', 'problem', 'focus', 'neutral'];

export const convergeAdapterPattern = definePattern({
  id: 'converge_adapter',
  family: 'flow',
  layoutMode: 'pipeline',
  paramsSchema: z.strictObject({
    inputs: z
      .array(lineText(24, 'One input in its own format, e.g. XML ORDER.'))
      .min(2)
      .max(4)
      .describe('The inputs, 2 to 4; each is drawn in a different style.'),
    hub: nodeParam('The adapter or gateway that normalises them.'),
    output: lineText(24, 'The one uniform output, e.g. ORDER EVENT.'),
    at: anchorsSchema(ANCHORS),
  }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  anchors: ANCHORS,
  targets: [
    { id: 'input-<n>', description: 'The n-th input (from 1).' },
    { id: 'link-<n>', description: 'Arrow from the n-th input into the hub.' },
    { id: 'hub', description: 'The adapter hub.' },
    { id: 'out-link', description: 'Arrow from the hub to the output.' },
    { id: 'output', description: 'The uniform output.' },
  ],
  description: {
    summary:
      'Two to four inputs, each drawn in a different style, flow into a hub; one output in a ' +
      'single, uniform style comes out. The visual point is many shapes in, one shape out.',
    whenToUse:
      'Adapters and normalisation: payment providers behind one gateway, log formats into one ' +
      'schema, model providers behind one client.',
    whenNotToUse:
      'One message copied out to many (use `fan_out`); a flood of identical requests (use ' +
      '`flood_then_funnel`).',
  },
  example: {
    params: {
      inputs: ['<example-input-1>', '<example-input-2>', '<example-input-3>'],
      hub: { title: '<example-hub>', icon: 'layers' },
      output: '<example-output>',
      at: {
        inputs: { type: 'word', index: 0 },
        convert: { type: 'word', index: 1 },
        output: { type: 'word', index: 2 },
      },
    },
  },
  expand: (p) => {
    const inputs = numbered('input', p.inputs.length);
    const links = numbered('link', p.inputs.length);
    return {
      elements: [
        ...p.inputs.map((text, i) =>
          el(nth('input', i), 'tag', { text, semantic: INPUT_STYLES[i] }, 'source'),
        ),
        ...inputs.map((input, i) => link(nth('link', i), input, 'hub')),
        el('hub', 'node_card', nodeProps(p.hub, { semantic: 'focus' }), 'stage'),
        link('out-link', 'hub', 'output', { semantic: 'ok' }),
        el('output', 'tag', { text: p.output, semantic: 'ok' }, 'sink'),
      ],
      events: [
        on(p.at.inputs, 'enter', inputs),
        on(p.at.convert, 'enter', ['hub', ...links]),
        on(p.at.convert, 'move', links),
        on(p.at.output, 'enter', ['out-link', 'output']),
        on(p.at.output, 'move', ['out-link']),
        on(p.at.output, 'highlight', ['output']),
      ],
    };
  },
});
