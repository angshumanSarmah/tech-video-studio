import type { Point } from '../primitives/geometry.ts';
import type { Rect, Theme } from '../theme/index.ts';
import type { Analysis } from './analyse.ts';
import type { Guide } from './blocks.ts';
import type { LayoutModeDefinition } from './modes.ts';
import { placeFollowers } from './relations.ts';
import { separate } from './separate.ts';
import type { ModeContext, Unit } from './types.ts';

/**
 * A board arranged in logical px (scale 1, any origin): the mode places the units (clusters),
 * overlapping units are pushed apart, each cluster is unpacked into its members, then everything
 * that follows another item gets its rect and path. Pure.
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
  const { theme } = params;
  const ctx = modeContext(analysis, params);
  const block = mode.place(ctx);
  const rects = new Map(block.rects);
  const movable = analysis.units
    .filter((u) => rects.has(u.key) && !isBackground(analysis, u.key))
    .map((u) => u.key);
  separate(rects, movable, ctx.gap);
  unpackClusters(analysis, rects);
  frameOnBase(analysis, mode, rects);
  const paths = new Map(block.routes);
  placeFollowers(analysis.items, rects, paths, {
    pinGap: theme.space.xs,
    portGap: theme.space.xs,
    labelBand: ctx.labelBand,
    ringPad: theme.space.md,
  });
  return { rects, paths, guides: block.guides };
}

function isBackground(analysis: Analysis, key: string): boolean {
  return analysis.items.some((i) => i.key === key && i.role === 'background');
}

/** Replaces each unit's cluster rect with its members' rects (the unit's own item included). */
function unpackClusters(analysis: Analysis, rects: Map<string, Rect>): void {
  for (const unit of analysis.units) {
    const at = rects.get(unit.key);
    const cluster = analysis.clusters.get(unit.key);
    if (!at || !cluster) continue;
    cluster.block.rects.forEach((r, key) => rects.set(key, { ...r, x: r.x + at.x, y: r.y + at.y }));
  }
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
    linkGap: linkGap(analysis, gap, band, params.aspect < 1),
    aspect: params.aspect,
    maxRowWidth: params.maxRowWidth,
    labelBand: band,
  };
}

/**
 * Space between linked units: room for a label on each side of the line, and for any midpoint
 * pin along the flow (its height in a tall frame, where links mostly run down; its width in a
 * wide one).
 */
function linkGap(analysis: Analysis, gap: number, band: number, tall: boolean): number {
  const pins = analysis.items
    .filter((i) => i.pin?.side === 'middle')
    .map((i) => (tall ? i.size.height : i.size.width) + 2 * gap);
  return Math.max(2 * gap, 2 * band, ...pins);
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
    if (item.role !== 'framed' || item.zone !== zone || item.target !== undefined) continue;
    rects.set(item.key, baseRect ?? { x: 0, y: 0, ...item.size });
  }
}
