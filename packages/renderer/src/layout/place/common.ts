import { column, EMPTY_BLOCK, row, single, wrap, type Block } from '../blocks.ts';
import type { ModeContext, Unit } from '../types.ts';

/** Helpers the mode placers share. */

export const ASIDE = 'aside';

export function unitBlock(unit: Unit): Block {
  return single(unit.key, unit.size);
}

export function zoneUnits(ctx: ModeContext, zone: string): readonly Unit[] {
  return ctx.zones.get(zone) ?? [];
}

export function zoneBlocks(ctx: ModeContext, zone: string): Block[] {
  return zoneUnits(ctx, zone).map(unitBlock);
}

/** The frame is taller than wide (the full format's stage). */
export function isTall(ctx: ModeContext): boolean {
  return ctx.aspect < 1;
}

/** A zone's units side by side, wrapped at the widest readable row. */
export function wrappedRow(ctx: ModeContext, zone: string): Block {
  return wrap(zoneBlocks(ctx, zone), ctx.maxRowWidth, ctx.gap);
}

/**
 * Adds the `aside` units to a mode's main block: below it in a tall frame (wrapped as rows),
 * to its right in a wide one (as a column).
 */
export function withAside(ctx: ModeContext, main: Block): Block {
  const asides = zoneBlocks(ctx, ASIDE);
  if (asides.length === 0) return main;
  if (isTall(ctx)) {
    return column([main, wrap(asides, ctx.maxRowWidth, ctx.gap)], ctx.linkGap);
  }
  return row([main, column(asides, ctx.gap)], ctx.linkGap);
}

/** Column of a zone's units (or an empty block). */
export function zoneColumn(ctx: ModeContext, zone: string): Block {
  const blocks = zoneBlocks(ctx, zone);
  return blocks.length > 0 ? column(blocks, ctx.gap) : EMPTY_BLOCK;
}
