import type { Rect } from '../../theme/index.ts';
import {
  column,
  combine,
  EMPTY_BLOCK,
  fromRects,
  row,
  shift,
  type Block,
  type GapAfter,
} from '../blocks.ts';
import { rectAt } from '../rect.ts';
import type { ModeContext, ModePlacer } from '../types.ts';
import {
  linked,
  unitBlock,
  withAside,
  wrappedRow,
  zoneBlocks,
  zoneColumn,
  zoneUnits,
} from './common.ts';

/** Placers for list-like modes: stacked_list, grid, two_column, versus_split. */

/**
 * Rows top to bottom, centred. Two rows a link joins get the link gap between them (room for its
 * label and any midpoint pin), others the plain gap.
 */
export const placeStackedList: ModePlacer = (ctx) => {
  const gapAfter: GapAfter = (block, next) =>
    next && linked(ctx, keysOf(block), keysOf(next)) ? ctx.linkGap : ctx.gap;
  return withAside(ctx, column(zoneBlocks(ctx, 'row'), gapAfter));
};

const keysOf = (block: Block): string[] => [...block.rects.keys()];

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

/**
 * One half of versus_split: its units top to bottom, those a link from the shared row reaches
 * first (otherwise every route from the shared row would cross the units above them), the rest
 * in spec order.
 */
function halfColumn(ctx: ModeContext, zone: string): Block {
  const shared = zoneUnits(ctx, 'shared').map((u) => u.key);
  const units = zoneUnits(ctx, zone);
  const reached = (key: string) => linked(ctx, shared, [key]);
  const ordered = [...units.filter((u) => reached(u.key)), ...units.filter((u) => !reached(u.key))];
  return ordered.length > 0 ? column(ordered.map(unitBlock), ctx.gap) : EMPTY_BLOCK;
}

/** Left column, then right column, centred on each other. */
export const placeTwoColumn: ModePlacer = (ctx) =>
  withAside(ctx, row([zoneColumn(ctx, 'left'), zoneColumn(ctx, 'right')], ctx.linkGap));

/**
 * Two halves for the same situation with a divider between them; `shared` elements in a row above
 * both halves (the event that hits both), so links from them run down into each half.
 */
export const placeVersusSplit: ModePlacer = (ctx) => {
  const left = halfColumn(ctx, 'left');
  const right = halfColumn(ctx, 'right');
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
  return column([wrappedRow(ctx, 'shared'), halves], ctx.linkGap);
};
