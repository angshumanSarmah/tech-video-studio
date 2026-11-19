import type { Rect } from '../../theme/index.ts';
import { combine, fromRects, shift, wrap } from '../blocks.ts';
import type { ModePlacer } from '../types.ts';
import { unitBlock, withAside, zoneUnits } from './common.ts';

/**
 * The first `base` element (a `map_base`) as the board; items in the `overlay` zone share its
 * rect (placed by the layout core, not here). `marker` elements sit in a wrapped row inside the
 * map's top edge. Further bases and the asides go beside it.
 */
export const placeMap: ModePlacer = (ctx) => {
  const [base, ...otherBases] = zoneUnits(ctx, 'base');
  const markers = zoneUnits(ctx, 'marker').map(unitBlock);
  if (!base) return withAside(ctx, wrap(markers, ctx.maxRowWidth, ctx.gap));
  const baseRect: Rect = { x: 0, y: 0, ...base.size };
  const inner = wrap(markers, base.size.width - 2 * ctx.gap, ctx.gap);
  const markerBlock = shift(inner, (base.size.width - inner.width) / 2, ctx.gap);
  const main = combine([fromRects(new Map([[base.key, baseRect]])), markerBlock]);
  const extras = otherBases.map(unitBlock);
  return withAside(
    ctx,
    extras.length > 0 ? wrap([main, ...extras], ctx.maxRowWidth, ctx.gap) : main,
  );
};
