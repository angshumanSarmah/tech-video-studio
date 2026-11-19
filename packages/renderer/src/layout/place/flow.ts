import { column, combine, row, shift, wrap, type Block } from '../blocks.ts';
import type { Link, ModeContext, ModePlacer, Unit } from '../types.ts';
import { isTall, unitBlock, withAside, zoneUnits } from './common.ts';

/** Placers for directed modes: pipeline and near_far. */

const FLOW_ZONES = ['source', 'stage', 'sink'] as const;

/**
 * Tiers in flow order: top-down in a tall frame (each tier a wrapped row), left-right in a wide one
 * (each tier a column). Tiers come from the connectors (longest path from the sources), with
 * `source` units first and `sink` units last; without connectors, one tier per zone.
 */
export const placePipeline: ModePlacer = (ctx) => {
  const tall = isTall(ctx);
  const blocks = pipelineTiers(ctx).map((tier) => {
    const parts = tier.map(unitBlock);
    return tall ? wrap(parts, ctx.maxRowWidth, ctx.gap) : column(parts, ctx.gap);
  });
  return withAside(ctx, tall ? column(blocks, ctx.linkGap) : row(blocks, ctx.linkGap));
};

/** The pipeline's units grouped into tiers, each ordered to reduce crossing connectors. */
export function pipelineTiers(ctx: ModeContext): Unit[][] {
  const units = FLOW_ZONES.flatMap((zone) => zoneUnits(ctx, zone));
  const zoneOf = new Map(units.map((u) => [u.key, u.zone]));
  const links = ctx.links.filter((l) => l.from !== l.to && zoneOf.has(l.from) && zoneOf.has(l.to));
  const ranks = longestPathRanks(units, links, zoneOf);
  const dense = [...new Set([...ranks.values()].sort((a, b) => a - b))];
  const tiers: Unit[][] = dense.map(() => []);
  for (const unit of units) tiers[dense.indexOf(ranks.get(unit.key) ?? 0)]?.push(unit);
  return orderTiers(tiers, links);
}

function longestPathRanks(
  units: readonly Unit[],
  links: readonly Link[],
  zoneOf: ReadonlyMap<string, string>,
): Map<string, number> {
  const hasSources = units.some((u) => u.zone === 'source');
  const ranks = new Map(units.map((u) => [u.key, u.zone !== 'source' && hasSources ? 1 : 0]));
  // At most one pass per unit: a cycle stops growing once ranks reach the unit count.
  for (let pass = 0; pass < units.length; pass += 1) {
    let changed = false;
    for (const link of links) {
      if (zoneOf.get(link.to) === 'source') continue;
      const next = Math.min((ranks.get(link.from) ?? 0) + 1, units.length);
      if ((ranks.get(link.to) ?? 0) < next) {
        ranks.set(link.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const last = Math.max(
    0,
    ...units.filter((u) => u.zone !== 'sink').map((u) => ranks.get(u.key) ?? 0),
  );
  const anyBeforeSinks = units.some((u) => u.zone !== 'sink');
  for (const unit of units) {
    if (unit.zone === 'sink') ranks.set(unit.key, anyBeforeSinks ? last + 1 : 0);
  }
  return ranks;
}

/** Each tier after the first sorted by the mean position of its predecessors (stable). */
function orderTiers(tiers: Unit[][], links: readonly Link[]): Unit[][] {
  const position = new Map<string, number>();
  return tiers.map((tier) => {
    const keyed = tier.map((unit, i) => {
      const preds = links
        .filter((l) => l.to === unit.key && position.has(l.from))
        .map((l) => position.get(l.from) ?? 0);
      const own = tier.length > 1 ? i / (tier.length - 1) : 0.5;
      const key = preds.length > 0 ? preds.reduce((a, b) => a + b, 0) / preds.length : own;
      return { unit, key };
    });
    const sorted = keyed.sort((a, b) => a.key - b.key).map((k) => k.unit);
    sorted.forEach((unit, i) =>
      position.set(unit.key, sorted.length > 1 ? i / (sorted.length - 1) : 0.5),
    );
    return sorted;
  });
}

/**
 * An origin with a near and a far destination, the distances to scale: the far one is at least
 * three times as far from the origin as the near one (centre to centre), along the frame's long
 * axis. When a connector joins near and far (a miss that goes on from the cache to the database)
 * they line up origin → near → far; otherwise the origin sits between them (near before it, far
 * after it), so the two links never cross.
 */
export const placeNearFar: ModePlacer = (ctx) => {
  const tall = isTall(ctx);
  const group = (zone: string): Block => {
    const parts = zoneUnits(ctx, zone).map(unitBlock);
    return tall ? wrap(parts, ctx.maxRowWidth, ctx.gap) : column(parts, ctx.gap);
  };
  const near = group('near');
  const origin = group('origin');
  const far = group('far');
  const extent = (b: Block) => (tall ? b.height : b.width);
  const nearDistance = extent(origin) / 2 + ctx.linkGap + extent(near) / 2;
  const chained = linksBetween(ctx, 'near', 'far');
  const clearOf = chained ? nearDistance + extent(near) / 2 : extent(origin) / 2;
  const farDistance = Math.max(3 * nearDistance, clearOf + ctx.linkGap + extent(far) / 2);
  const at = (b: Block, d: number) =>
    tall ? shift(b, -b.width / 2, d - b.height / 2) : shift(b, d - b.width / 2, -b.height / 2);
  const main = combine([
    ...(extent(near) > 0 ? [at(near, chained ? nearDistance : -nearDistance)] : []),
    at(origin, 0),
    ...(extent(far) > 0 ? [at(far, farDistance)] : []),
  ]);
  return withAside(ctx, main);
};

/** True when a connector joins a unit of zone `a` and one of zone `b` (either way). */
function linksBetween(ctx: ModeContext, a: string, b: string): boolean {
  const keys = (zone: string) => new Set(zoneUnits(ctx, zone).map((u) => u.key));
  const inA = keys(a);
  const inB = keys(b);
  return ctx.links.some(
    (l) => (inA.has(l.from) && inB.has(l.to)) || (inB.has(l.from) && inA.has(l.to)),
  );
}
