import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { idsOf, lineText, PartIdSchema, partList, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const RouteStopSchema = z.strictObject({
  id: PartIdSchema,
  label: lineText(14, 'Short name of the place, e.g. a pickup point.').optional(),
});

export const RoutePathPropsSchema = z.strictObject({
  stops: partList(
    RouteStopSchema,
    { min: 2, max: 6 },
    'Named stops in travel order, first to last.',
  ),
  distance: lineText(12, 'Optional distance or time tag shown at the end, e.g. 4.2 km.').optional(),
  semantic: semanticProp('focus', 'Route colour'),
});
export type RoutePathProps = z.output<typeof RoutePathPropsSchema>;

const MIN_WIDTH = 600;
const MIN_HEIGHT = 420;

/** Width a stop needs for its label, so neighbouring labels never touch. */
export function stopLabelWidth(props: RoutePathProps, theme: Theme): number {
  const longest = Math.max(
    0,
    ...props.stops.map((s) => (s.label ? approxTextWidth(theme, 'label', s.label) : 0)),
  );
  return longest + theme.space.sm;
}

/** Room around the route for pins (above) and stop labels (below). */
export function routeInset(theme: Theme): { x: number; y: number } {
  return { x: theme.space.xl, y: theme.space.xl + lineHeightPx(theme, 'label') };
}

export function routePathSizeHints(props: RoutePathProps, theme: Theme): SizeHints {
  const inset = routeInset(theme);
  const width = Math.max(
    MIN_WIDTH,
    props.stops.length * stopLabelWidth(props, theme) + 2 * inset.x,
  );
  const height = MIN_HEIGHT + 2 * inset.y;
  return {
    minWidth: width,
    minHeight: height,
    preferredWidth: Math.max(width, 840),
    preferredHeight: Math.max(height, 620),
  };
}

export const routePathPrimitive = definePrimitive({
  id: 'route_path',
  family: 'spatial',
  propsSchema: RoutePathPropsSchema,
  actions: ['enter', 'exit', 'move', 'highlight', 'dim', 'pulse'],
  sizeHints: routePathSizeHints,
  parts: { actions: ['highlight', 'pulse', 'reject'], ids: (props) => idsOf(props.stops) },
  description: {
    summary:
      'A glowing route through named `stops`, with a pin at the start and at the end and an ' +
      'optional `distance` tag. `enter` shows the pins; `move` draws the route from the first ' +
      'stop to the last (the tag lands when it arrives). Stops are parts: highlight one, or ' +
      'reject it (a red cross: closed, unreachable).',
    whenToUse:
      'A journey on a map: a driver to a pickup, a parcel from store to door, a packet hopping ' +
      'between regions. Put it over a `map_base`.',
    whenNotToUse:
      'A link between two components (use `connector`); traffic over time (use ' +
      '`packet_stream`); areas on a map (use `zone_polygon`).',
  },
  example: {
    props: {
      stops: [
        { id: 'start', label: '<example-stop>' },
        { id: 'end', label: '<example-stop>' },
      ],
      distance: '<example-km>',
    },
  },
});
