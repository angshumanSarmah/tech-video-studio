import { PLATFORM_ZONES, PLATFORMS, type Rect, type Theme } from './schema.ts';

export type { Rect } from './schema.ts';

/** An exclusion zone with its origin, e.g. `shorts.actions`. */
export type Zone = Rect & { id: string };

export type SafeAreas = {
  canvas: Rect;
  /** Every platform's exclusion zones, in canvas coordinates. */
  exclusionZones: Zone[];
  /** Directly below the lowest top bar; centred, clear of every zone. */
  hudBand: Rect;
  /** Directly above the highest bottom info; centred, clear of every zone. */
  subtitleBand: Rect;
  /** Full width between the gutters, from the HUD band's bottom to the subtitle band's top. */
  stage: Rect;
  /** Top of the stage, for the beat headline; centred, clear of every zone. */
  headlineBand: Rect;
  /** The stage below the headline band: what a beat with a headline has left for its board. */
  stageWithHeadline: Rect;
  /**
   * Exclusion zones clipped to the stage, minus any contained in another. The layout engine keeps
   * text and key elements out of them; background decoration may pass under.
   */
  avoidZones: Zone[];
};

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;

export function exclusionZones(theme: Theme): Zone[] {
  return PLATFORMS.flatMap((platform) =>
    PLATFORM_ZONES.map((zone) => ({
      id: `${platform}.${zone}`,
      ...theme.safeArea.platforms[platform][zone],
    })),
  );
}

/** Overlap of two rects, or null when they only touch or are apart. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(right(a), right(b)) - x;
  const height = Math.min(bottom(a), bottom(b)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    right(inner) <= right(outer) &&
    bottom(inner) <= bottom(outer)
  );
}

/**
 * Narrows `band` equally on both sides until no zone overlaps it, keeping it centred on the
 * canvas. A zone counts against the side of the canvas it sits on.
 */
export function clearSymmetric(band: Rect, zones: readonly Rect[], canvasWidth: number): Rect {
  const inset = zones.reduce((acc, zone) => {
    if (!intersect(band, zone)) return acc;
    const onLeft = zone.x + zone.width / 2 < canvasWidth / 2;
    return Math.max(acc, onLeft ? right(zone) : canvasWidth - zone.x);
  }, band.x);
  return { ...band, x: inset, width: canvasWidth - 2 * inset };
}

/** Clips zones to `area` and drops any clipped zone contained in an earlier or larger one. */
export function clipZones(zones: readonly Zone[], area: Rect): Zone[] {
  const clipped = zones.flatMap((zone) => {
    const r = intersect(zone, area);
    return r ? [{ id: zone.id, ...r }] : [];
  });
  return clipped.filter(
    (zone, i) =>
      !clipped.some(
        (other, j) => j !== i && contains(other, zone) && (!contains(zone, other) || j < i),
      ),
  );
}

function assertNonEmpty(name: string, r: Rect, themeId: string): void {
  if (!(r.width > 0 && r.height > 0)) {
    throw new Error(`Theme "${themeId}": safe-area ${name} is empty (${r.width}x${r.height})`);
  }
}

export function safeAreas(theme: Theme): SafeAreas {
  const { width, height } = theme.canvas;
  const { platforms, gutter, hudBand: hudHeight, subtitleBand: subHeight } = theme.safeArea;
  const zones = exclusionZones(theme);
  const top = Math.max(...PLATFORMS.map((p) => bottom(platforms[p].topBar)));
  const floor = Math.min(...PLATFORMS.map((p) => platforms[p].bottomInfo.y));
  const full = { x: gutter, width: width - 2 * gutter };

  const hudBand = clearSymmetric({ ...full, y: top, height: hudHeight }, zones, width);
  const subtitleBand = clearSymmetric(
    { ...full, y: floor - subHeight, height: subHeight },
    zones,
    width,
  );
  const stage = { ...full, y: bottom(hudBand), height: subtitleBand.y - bottom(hudBand) };
  const headlineBand = clearSymmetric(
    { ...full, y: stage.y, height: theme.safeArea.headlineBand },
    zones,
    width,
  );
  const stageWithHeadline = {
    ...stage,
    y: bottom(headlineBand),
    height: bottom(stage) - bottom(headlineBand),
  };
  const areas = {
    canvas: { x: 0, y: 0, width, height },
    exclusionZones: zones,
    hudBand,
    subtitleBand,
    stage,
    headlineBand,
    stageWithHeadline,
    avoidZones: clipZones(zones, stage),
  };
  for (const name of [
    'hudBand',
    'subtitleBand',
    'stage',
    'headlineBand',
    'stageWithHeadline',
  ] as const) {
    assertNonEmpty(name, areas[name], theme.id);
  }
  return areas;
}
