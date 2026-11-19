import type { Rect } from '../../theme/index.ts';
import { column, combine, EMPTY_BLOCK, fromRects, row, shift } from '../blocks.ts';
import { rectAt } from '../rect.ts';
import type { ModeContext, ModePlacer } from '../types.ts';
import { withAside, wrappedRow, zoneBlocks, zoneColumn, zoneUnits } from './common.ts';

/** Placers for list-like modes: stacked_list, grid, two_column, versus_split. */

/** Rows top to bottom, centred. */
export const placeStackedList: ModePlacer = (ctx) =>
  withAside(ctx, column(zoneBlocks(ctx, 'row'), ctx.gap));

/**
 * Equal cells: the column count whose grid is closest to the frame's shape, every cell as large as
 * the largest unit, units centred in their cells, the last row centred.
 */
export const placeGrid: ModePlacer = (ctx) => {
  const units = zoneUnits(ctx, 'cell');
  if (units.length === 0) return withAside(ctx, EMPTY_BLOCK);
  const cell = {
    width: Math.max(...units.map((u) => u.size.width)),
    height: Math.max(...units.map((u) => u.size.height)),
  };
  const cols = bestColumns(units.length, cell, ctx);
  const lastRow = Math.floor((units.length - 1) / cols);
  const lastIndent = ((cols - (units.length - lastRow * cols)) * (cell.width + ctx.gap)) / 2;
  const rects = new Map<string, Rect>();
  units.forEach((u, i) => {
    const r = Math.floor(i / cols);
    const x = (i % cols) * (cell.width + ctx.gap) + (r === lastRow ? lastIndent : 0);
    const y = r * (cell.height + ctx.gap);
    rects.set(u.key, rectAt({ x: x + cell.width / 2, y: y + cell.height / 2 }, u.size));
  });
  return withAside(ctx, fromRects(rects));
};

function bestColumns(
  count: number,
  cell: { width: number; height: number },
  ctx: ModeContext,
): number {
  let best = 1;
  let bestScore = Infinity;
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const width = cols * cell.width + (cols - 1) * ctx.gap;
    const height = rows * cell.height + (rows - 1) * ctx.gap;
    const score = Math.abs(Math.log(width / height / ctx.aspect));
    if (score < bestScore - 1e-9) {
      best = cols;
      bestScore = score;
    }
  }
  return best;
}

/** Left column, then right column, centred on each other. */
export const placeTwoColumn: ModePlacer = (ctx) =>
  withAside(ctx, row([zoneColumn(ctx, 'left'), zoneColumn(ctx, 'right')], ctx.linkGap));

/**
 * Two halves for the same situation with a divider between them; `shared` elements in a row under
 * both halves (or beside them in a wide frame, where there is no room below).
 */
export const placeVersusSplit: ModePlacer = (ctx) => {
  const left = zoneColumn(ctx, 'left');
  const right = zoneColumn(ctx, 'right');
  const gap = Math.max(2 * ctx.gap, ctx.linkGap);
  const height = Math.max(left.height, right.height);
  const halves = combine(
    [
      shift(left, 0, (height - left.height) / 2),
      shift(right, left.width + gap, (height - right.height) / 2),
    ],
    left.width > 0 && right.width > 0
      ? [{ from: { x: left.width + gap / 2, y: 0 }, to: { x: left.width + gap / 2, y: height } }]
      : [],
  );
  return column([halves, wrappedRow(ctx, 'shared')], ctx.linkGap);
};
