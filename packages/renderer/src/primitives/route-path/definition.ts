import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import {
  AssetIdSchema,
  idsOf,
  lineText,
  PartIdSchema,
  partList,
  semanticProp,
} from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type EventSummary, type SizeHints } from '../types.ts';
import { excessMoves, ROUTE_MODES } from './route.ts';

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
  mode: z
    .enum(ROUTE_MODES)
    .optional()
    .describe(
      'Optional: jumpy (the mover hops stop to stop, one per move, until a morph smooths the ' +
        'route) or smooth (move draws a curve through the stops). Omit for street-like legs.',
    ),
  mover: AssetIdSchema.optional().describe(
    'Optional asset id of what travels the route (a bike, a car, a parcel).',
  ),
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

/** A jumpy route steps once per whole-element `move`; more moves than hops are a mistake. */
export function routePathEventWarnings(props: RoutePathProps, events: readonly EventSummary[]) {
  if (props.mode !== 'jumpy') return [];
  const moves = events.filter((e) => e.action === 'move' && !e.parts).length;
  if (excessMoves(props.stops.length, moves) === 0) return [];
  return [
    {
      code: 'route_moves_exceed_stops',
      message:
        `A jumpy route steps one stop per move: ${moves} moves for ${props.stops.length} ` +
        `stops (at most ${props.stops.length - 1}). Remove moves or add stops.`,
    },
  ];
}

export const routePathPrimitive = definePrimitive({
  id: 'route_path',
  family: 'spatial',
  propsSchema: RoutePathPropsSchema,
  actions: ['enter', 'exit', 'move', 'morph', 'highlight', 'dim', 'pulse'],
  sizeHints: routePathSizeHints,
  assetRefs: (props) =>
    props.mover ? [{ path: ['mover'], id: props.mover, family: 'transport' as const }] : [],
  eventWarnings: routePathEventWarnings,
  parts: { actions: ['highlight', 'pulse', 'reject'], ids: (props) => idsOf(props.stops) },
  description: {
    summary:
      'A glowing route through named `stops`, with a pin at the start and at the end and an ' +
      'optional `distance` tag. `enter` shows the pins; `move` draws the route from the first ' +
      'stop to the last (the tag lands when it arrives), with the optional `mover` riding its ' +
      'head. `mode` smooth draws a curve instead of street legs. `mode` jumpy shows raw ' +
      'position pings: each `move` hops the `mover` to the next stop (one `move` per stop ' +
      'after the first), then a `morph` draws a smooth curve through the stops and the mover ' +
      'glides along it. Stops are parts: highlight one, or reject it (a red cross: closed, ' +
      'unreachable).',
    whenToUse:
      'A journey on a map: a driver to a pickup, a parcel from store to door, a packet hopping ' +
      'between regions. Put it over a `map_base`. Jumpy then smooth: raw GPS pings vs an ' +
      'interpolated track.',
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
      mode: 'jumpy',
      mover: 'bike',
    },
  },
});
