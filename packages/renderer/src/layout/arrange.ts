import type { Point } from '../primitives/geometry.ts';
import type { Rect, Theme } from '../theme/index.ts';
import type { Analysis } from './analyse.ts';
import type { Guide } from './blocks.ts';
import type { LayoutModeDefinition } from './modes.ts';
import { separate } from './separate.ts';
import type { ModeContext, Unit } from './types.ts';

/**
 * A board arranged in logical px (scale 1, any origin): the mode places the units, overlapping
 * solids are pushed apart, then everything that follows another item gets its rect. Pure.
 */

export type Arranged = {
  rects: ReadonlyMap<string, Rect>;
  /** Paths of relational items, in logical px. */
  paths: ReadonlyMap<string, readonly Point[]>;
  guides: readonly Guide[];
};

export type ArrangeParams = {
  theme: Theme;
  /** Frame width / height. */
  aspect: number;
  /** Widest row (logical px) readable in the frame. */
  maxRowWidth: number;
  focus: ReadonlySet<string>;
};

export function arrange(
  analysis: Analysis,
  mode: LayoutModeDefinition,
  params: ArrangeParams,
): Arranged {
  const ctx = modeContext(analysis, params);
  const block = mode.place(ctx);
  const rects = new Map(block.rects);
  const solids = analysis.items.filter((i) => i.role === 'solid' && rects.has(i.key));
  separate(
    rects,
    solids.map((i) => i.key),
    ctx.gap,
  );
  frameOnBase(analysis, mode, rects);
  return { rects, paths: new Map(block.routes), guides: block.guides };
}

export function modeContext(analysis: Analysis, params: ArrangeParams): ModeContext {
  const { theme } = params;
  const zones = new Map<string, Unit[]>();
  for (const unit of analysis.units) zones.set(unit.zone, [...(zones.get(unit.zone) ?? []), unit]);
  const gap = theme.space.lg;
  const band = labelBand(theme);
  return {
    zones,
    links: analysis.links,
    focus: params.focus,
    gap,
    linkGap: Math.max(2 * gap, 2 * band),
    aspect: params.aspect,
    maxRowWidth: params.maxRowWidth,
    labelBand: band,
  };
}

/** Room above (and below) a line for its label: one label line plus a little air. */
export function labelBand(theme: Theme): number {
  const { size, lineHeight } = theme.text.label;
  return Math.max(Math.ceil(size * lineHeight) + theme.space.xs, theme.space.lg);
}

/** Framed items share the rect of the mode's first base element (overlays on a map). */
function frameOnBase(analysis: Analysis, mode: LayoutModeDefinition, rects: Map<string, Rect>) {
  if (!mode.frameZone) return;
  const { zone, base } = mode.frameZone;
  const baseKey = analysis.units.find((u) => u.zone === base)?.key;
  const baseRect = baseKey ? rects.get(baseKey) : undefined;
  for (const item of analysis.items) {
    if (item.role !== 'framed' || item.zone !== zone) continue;
    rects.set(item.key, baseRect ?? { x: 0, y: 0, ...item.size });
  }
}
