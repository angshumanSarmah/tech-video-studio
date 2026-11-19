import { z } from 'zod';
import {
  elementRefProp,
  idsOf,
  lineText,
  PartIdSchema,
  partList,
  semanticProp,
} from '../common-props.ts';
import { mapSizeHints } from '../map-base/definition.ts';
import { definePrimitive } from '../types.ts';

export const GRID_MAX = 12;

export const GridCellSchema = z.strictObject({
  id: PartIdSchema,
  row: z.number().int().min(1).max(GRID_MAX).describe('Row, counted from 1 at the top.'),
  col: z.number().int().min(1).max(GRID_MAX).describe('Column, counted from 1 at the left.'),
  label: lineText(14, 'Optional tag shown when the cell lights up, e.g. HOT CELL.').optional(),
  semantic: semanticProp('focus', 'Cell colour when lit'),
});

export const GridOverlayPropsSchema = z
  .strictObject({
    rows: z.number().int().min(2).max(GRID_MAX).describe('Number of rows (2 to 12).'),
    cols: z.number().int().min(2).max(GRID_MAX).describe('Number of columns (2 to 12).'),
    over: elementRefProp(
      'Optional id of the map_base or zone_polygon the grid lies over.',
    ).optional(),
    cells: partList(
      GridCellSchema,
      { min: 0, max: 8 },
      'Cells events can light up, by row and column.',
    ).default([]),
  })
  .superRefine((props, ctx) => {
    props.cells.forEach((cell, i) => {
      if (cell.row > props.rows) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', i, 'row'],
          message: `Row ${cell.row} is outside ${props.rows} rows.`,
        });
      }
      if (cell.col > props.cols) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', i, 'col'],
          message: `Column ${cell.col} is outside ${props.cols} columns.`,
        });
      }
    });
  });
export type GridOverlayProps = z.output<typeof GridOverlayPropsSchema>;

export const gridOverlayPrimitive = definePrimitive({
  id: 'grid_overlay',
  family: 'spatial',
  propsSchema: GridOverlayPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim'],
  sizeHints: mapSizeHints,
  elementRefs: (props) =>
    props.over
      ? [{ path: ['over'], id: props.over, primitives: ['map_base', 'zone_polygon'] }]
      : [],
  parts: { actions: ['highlight', 'pulse', 'reject', 'dim'], ids: (props) => idsOf(props.cells) },
  description: {
    summary:
      'A grid of square cells dropped over a map or zones. `enter` drops it in from above. ' +
      'The `cells` are parts addressed by row and column: `highlight` one to light it with its ' +
      'tag (e.g. HOT CELL), `pulse` it for attention, `reject` it to turn it red.',
    whenToUse:
      'Turning space into buckets: geohash cells, a spatial index, a quadtree level, ' +
      'partitioning a city for drivers. Set `over` to the `map_base` it divides.',
    whenNotToUse:
      'Irregular areas (use `zone_polygon`); a grid of items or seats (use `slot_grid`); a ' +
      'table of data (use `data_block`).',
  },
  example: {
    props: {
      rows: 6,
      cols: 6,
      over: 'example-map',
      cells: [{ id: 'mine', row: 3, col: 4, label: '<example-tag>' }],
    },
  },
});
