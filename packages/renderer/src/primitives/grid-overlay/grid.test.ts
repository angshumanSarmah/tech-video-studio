import { describe, expect, it } from 'vitest';
import { gridOverlayPrimitive, GridOverlayPropsSchema } from './definition.ts';
import { cellRect, gridGeometry } from './grid.ts';

describe('gridGeometry', () => {
  it('fits square cells and centres the grid', () => {
    const g = gridGeometry(4, 8, { width: 800, height: 600 });
    expect(g).toEqual({ cell: 100, x: 0, y: 100, width: 800, height: 400 });
  });

  it('places cells by 1-based row and column', () => {
    const g = gridGeometry(4, 4, { width: 400, height: 400 });
    expect(cellRect(g, 1, 1)).toEqual({ x: 0, y: 0, size: 100 });
    expect(cellRect(g, 3, 4)).toEqual({ x: 300, y: 200, size: 100 });
  });
});

describe('grid_overlay props', () => {
  it('refuses cells outside the grid', () => {
    const result = GridOverlayPropsSchema.safeParse({
      rows: 3,
      cols: 3,
      cells: [{ id: 'far', row: 4, col: 3 }],
    });
    expect(result.error?.issues.map((i) => i.path)).toEqual([['cells', 0, 'row']]);
  });

  it('lies over a map or zones only, and exposes cells as parts', () => {
    const props = GridOverlayPropsSchema.parse({
      rows: 3,
      cols: 3,
      over: 'city',
      cells: [{ id: 'mine', row: 2, col: 2 }],
    });
    expect(gridOverlayPrimitive.elementRefs?.(props)).toEqual([
      { path: ['over'], id: 'city', primitives: ['map_base', 'zone_polygon'] },
    ]);
    expect(gridOverlayPrimitive.parts?.ids(props)).toEqual(['mine']);
    const alone = GridOverlayPropsSchema.parse({ rows: 3, cols: 3 });
    expect(gridOverlayPrimitive.elementRefs?.(alone)).toEqual([]);
  });
});
