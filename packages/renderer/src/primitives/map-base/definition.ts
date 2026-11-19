import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { definePrimitive, type Size, type SizeHints } from '../types.ts';
import { MAP_VARIANTS } from './city.ts';

export const MapBasePropsSchema = z.strictObject({
  variant: z
    .enum(MAP_VARIANTS)
    .default('downtown')
    .describe('City style: downtown (dense blocks), suburb (large blocks, parks) or riverside.'),
});
export type MapBaseProps = z.output<typeof MapBasePropsSchema>;

/** A map fills most of the stage; overlays (`grid_overlay`) default to the same box. */
export const MAP_PREFERRED: Size = { width: 880, height: 880 };
const MAP_MIN: Size = { width: 600, height: 600 };

export function mapSizeHints(_props: unknown, _theme: Theme): SizeHints {
  return {
    minWidth: MAP_MIN.width,
    minHeight: MAP_MIN.height,
    preferredWidth: MAP_PREFERRED.width,
    preferredHeight: MAP_PREFERRED.height,
  };
}

export const mapBasePrimitive = definePrimitive({
  id: 'map_base',
  family: 'spatial',
  propsSchema: MapBasePropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim'],
  layoutRole: 'background',
  sizeHints: mapSizeHints,
  description: {
    summary:
      'A stylised top-down city: blocks, streets, avenues, parks and, in the riverside ' +
      '`variant`, a river. A quiet background that map scenes draw on; it carries no labels. ' +
      '`dim` pushes it further back; `highlight` brings it forward again.',
    whenToUse:
      'Any scene set in a city: ride hailing, deliveries, store coverage, nearby search. Put ' +
      '`route_path`, `zone_polygon` and `grid_overlay` over it.',
    whenNotToUse:
      'Abstract systems with no geography (use `node_card` and `connector`); a world or region ' +
      'map; a background for its own sake.',
  },
  example: { props: { variant: 'downtown' } },
});
