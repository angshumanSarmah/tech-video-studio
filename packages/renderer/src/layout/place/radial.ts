import type { Rect } from '../../theme/index.ts';
import { column, fromRects, row, wrap, type Block } from '../blocks.ts';
import { inflate, overlaps, rectAt } from '../rect.ts';
import type { ModeContext, ModePlacer, Unit } from '../types.ts';
import { unitBlock, withAside, zoneUnits } from './common.ts';

/** Placers with a middle: centered_focus, hub_spoke and cycle. */

/**
 * One element in the middle with the rest around it: above and below in a tall frame (rows, the
 * first half above), left and right in a wide one (columns). Without a `center` element, the
 * first focus element moves to the middle.
 */
export const placeCenteredFocus: ModePlacer = (ctx) => placeAround(ctx, 'center', 'around');

/** The hub in the middle, the spokes around it, as `centered_focus`. */
export const placeHubSpoke: ModePlacer = (ctx) => placeAround(ctx, 'hub', 'spoke');

function placeAround(ctx: ModeContext, middleZone: string, aroundZone: string): Block {
  const { middle, around } = splitMiddle(ctx, middleZone, aroundZone);
  const centre = column(middle.map(unitBlock), ctx.gap);
  const half = Math.ceil(around.length / 2);
  const first = around.slice(0, half).map(unitBlock);
  const second = around.slice(half).map(unitBlock);
  const main = tallish(ctx)
    ? column(
        [wrap(first, ctx.maxRowWidth, ctx.gap), centre, wrap(second, ctx.maxRowWidth, ctx.gap)],
        ctx.linkGap,
      )
    : row([column(first, ctx.gap), centre, column(second, ctx.gap)], ctx.linkGap);
  return withAside(ctx, main);
}

const tallish = (ctx: ModeContext) => ctx.aspect < 1.2;

function splitMiddle(ctx: ModeContext, middleZone: string, aroundZone: string) {
  const middle = [...zoneUnits(ctx, middleZone)];
  let around = [...zoneUnits(ctx, aroundZone)];
  if (middle.length === 0) {
    const promoted = around.find((u) => ctx.focus.has(u.key)) ?? around[0];
    if (promoted) {
      middle.push(promoted);
      around = around.filter((u) => u !== promoted);
    }
  }
  return { middle, around };
}

/**
 * Steps on an ellipse, clockwise from the top, far enough apart that neighbours clear each other
 * and the middle element.
 */
export const placeCycle: ModePlacer = (ctx) => {
  const ring = zoneUnits(ctx, 'ring');
  const middle = zoneUnits(ctx, 'center');
  const centre = column(middle.map(unitBlock), ctx.gap);
  const rects = new Map<string, Rect>();
  if (centre.width > 0) {
    centre.rects.forEach((r, k) =>
      rects.set(k, { ...r, x: r.x - centre.width / 2, y: r.y - centre.height / 2 }),
    );
  }
  const radii = ringRadii(ctx, ring, centre);
  ringRects(ring, radii).forEach((r, k) => rects.set(k, r));
  return withAside(ctx, fromRects(rects));
};

type Radii = { rx: number; ry: number };

function ringRects(ring: readonly Unit[], { rx, ry }: Radii): Map<string, Rect> {
  return new Map(
    ring.map((unit, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / ring.length;
      return [unit.key, rectAt({ x: rx * Math.cos(angle), y: ry * Math.sin(angle) }, unit.size)];
    }),
  );
}

/** Radii from the chord between neighbours, grown until consecutive steps clear each other. */
function ringRadii(ctx: ModeContext, ring: readonly Unit[], centre: Block): Radii {
  if (ring.length <= 1) return { rx: 0, ry: 0 };
  const w = Math.max(...ring.map((u) => u.size.width));
  const h = Math.max(...ring.map((u) => u.size.height));
  const chord = 2 * Math.sin(Math.PI / ring.length);
  let rx = (w + ctx.linkGap) / chord;
  let ry = (h + ctx.linkGap) / chord;
  if (centre.width > 0) {
    rx = Math.max(rx, Math.SQRT2 * (centre.width / 2 + ctx.linkGap + w / 2));
    ry = Math.max(ry, Math.SQRT2 * (centre.height / 2 + ctx.linkGap + h / 2));
  }
  for (let i = 0; i < 80 && neighboursOverlap(ring, { rx, ry }, ctx.gap); i += 1) {
    rx *= 1.05;
    ry *= 1.05;
  }
  return { rx, ry };
}

function neighboursOverlap(ring: readonly Unit[], radii: Radii, gap: number): boolean {
  const rects = [...ringRects(ring, radii).values()].map((r) => inflate(r, gap / 2));
  return rects.some((r, i) => {
    const next = rects[(i + 1) % rects.length];
    return next !== undefined && next !== r && overlaps(r, next);
  });
}
