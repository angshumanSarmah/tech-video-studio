import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { idsOf, lineText, PartIdSchema, partList, semanticProp } from '../common-props.ts';
import { definePrimitive, type SizeHints } from '../types.ts';
import { MAX_ZONES } from './zones.ts';

export const ZoneSchema = z.strictObject({
  id: PartIdSchema,
  label: lineText(16, 'Name of the area, e.g. a delivery zone.'),
  semantic: semanticProp('concept', 'Zone colour'),
});

export const ZonePolygonPropsSchema = z.strictObject({
  zones: partList(ZoneSchema, { min: 1, max: MAX_ZONES }, 'The areas, 1 to 6.'),
  overlap: z
    .boolean()
    .default(true)
    .describe('Whether neighbouring zones overlap (shared coverage) or keep a gap.'),
});
export type ZonePolygonProps = z.output<typeof ZonePolygonPropsSchema>;

export function zonePolygonSizeHints(_props: ZonePolygonProps, _theme: Theme): SizeHints {
  return { minWidth: 600, minHeight: 520, preferredWidth: 840, preferredHeight: 720 };
}

export const zonePolygonPrimitive = definePrimitive({
  id: 'zone_polygon',
  family: 'spatial',
  propsSchema: ZonePolygonPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: zonePolygonSizeHints,
  parts: {
    actions: ['enter', 'exit', 'highlight', 'dim', 'pulse', 'reject'],
    ids: (props) => idsOf(props.zones),
  },
  description: {
    summary:
      'Labelled areas drawn as soft, irregular shapes that can overlap. The `zones` are parts: ' +
      '`highlight` one to make it glow, `reject` to turn it red (overloaded, out of service), ' +
      '`dim` to push it back, `enter` to reveal it on its own word.',
    whenToUse:
      'Regions on a map or coverage areas: delivery zones, cell towers, shards by region, ' +
      'availability zones. Put it over a `map_base`.',
    whenNotToUse:
      'A regular grid of cells (use `grid_overlay`); components with names (use `node_card`); ' +
      'items in slots (use `slot_grid`).',
  },
  example: {
    props: {
      zones: [
        { id: 'zone-a', label: '<example-area>' },
        { id: 'zone-b', label: '<example-area>' },
      ],
    },
  },
});
