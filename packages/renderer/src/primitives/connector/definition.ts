import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { elementRefProp, lineText, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const CONNECTOR_HEADS = ['end', 'both', 'none'] as const;

export const ConnectorPropsSchema = z
  .strictObject({
    from: elementRefProp('Id of the element in this beat where the connector starts.'),
    to: elementRefProp('Id of the element in this beat it points to.'),
    label: lineText(20, 'Optional label at the middle: what travels, or the relation.').optional(),
    heads: z
      .enum(CONNECTOR_HEADS)
      .default('end')
      .describe('Arrowheads: end (one-way arrow), both (two-way) or none (plain line).'),
    dashed: z.boolean().default(false).describe('Dashed: an optional, async or planned link.'),
    semantic: semanticProp('neutral', 'Line colour'),
  })
  .refine((p) => p.from !== p.to, { message: 'from and to must differ.', path: ['to'] });
export type ConnectorProps = z.output<typeof ConnectorPropsSchema>;

/** Shortest standalone span; the layout engine (P1A.9) stretches it between its endpoints. */
const MIN_SPAN = 200;

/** Distance from each end of the box to the endpoint, leaving room for an arrowhead. */
export function connectorInset(theme: Theme): number {
  return theme.space.sm;
}

/**
 * The connector's own box when it stands alone (before the layout engine places it between its
 * endpoints): the line through the middle, with room above for the label and below for a packet
 * or reject mark of the same height.
 */
export function connectorSizeHints(props: ConnectorProps, theme: Theme): SizeHints {
  const label = props.label ? approxTextWidth(theme, 'label', props.label) : 0;
  const width = Math.max(MIN_SPAN, label + 2 * theme.space.md) + 2 * connectorInset(theme);
  const band = Math.max(lineHeightPx(theme, 'label') + theme.space.xs, theme.space.lg);
  const height = 2 * band + theme.stroke.bold;
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const connectorPrimitive = definePrimitive({
  id: 'connector',
  family: 'flow',
  propsSchema: ConnectorPropsSchema,
  actions: ['enter', 'exit', 'move', 'highlight', 'dim', 'pulse', 'reject'],
  sizeHints: connectorSizeHints,
  elementRefs: (props) => [
    { path: ['from'], id: props.from },
    { path: ['to'], id: props.to },
  ],
  description: {
    summary:
      'An arrow or line from one element to another, with an optional label at its middle. ' +
      '`enter` draws it from `from` to `to`; each `move` sends one glowing packet along it; ' +
      '`reject` turns it red with a cross at the middle (the link is broken or refused).',
    whenToUse:
      'A relation or a hop between two elements already in the beat: a request from client to ' +
      'server, a write to a database, a replica link. Use `move` on the word where one thing ' +
      'travels.',
    whenNotToUse:
      'Continuous traffic (add a `packet_stream` along the connector); a journey on a map (use ' +
      '`route_path`); a queue of waiting items (use `conveyor_queue`).',
  },
  example: {
    props: { from: 'example-client', to: 'example-server', label: '<example-label>' },
  },
});
