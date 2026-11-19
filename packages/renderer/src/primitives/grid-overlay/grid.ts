import type { Size } from '../types.ts';

/** Square cells of a `grid_overlay`, as large as fit, centred in the box. */
export type GridGeometry = { cell: number; x: number; y: number; width: number; height: number };

export function gridGeometry(rows: number, cols: number, box: Size): GridGeometry {
  const cell = Math.min(box.width / cols, box.height / rows);
  const width = cell * cols;
  const height = cell * rows;
  return { cell, x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

/** Box of the cell at 1-based `row` and `col`. */
export function cellRect(g: GridGeometry, row: number, col: number) {
  return { x: g.x + (col - 1) * g.cell, y: g.y + (row - 1) * g.cell, size: g.cell };
}
