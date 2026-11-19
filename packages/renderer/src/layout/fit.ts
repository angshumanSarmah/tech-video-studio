import type { Point } from '../primitives/geometry.ts';
import type { Rect, Zone } from '../theme/index.ts';
import type { Arranged } from './arrange.ts';
import { bottom, overlaps, pathCrossesRect, pointsRect, right, union } from './rect.ts';

/**
 * Fitting an arranged board into its frame: one uniform scale (never above 1, so nothing is drawn
 * larger than its preferred size) and the board centred. Then the avoid zones: nothing may overlap
 * them, so a board that does is slid out of them or re-fitted into the part of the frame beside
 * or above them (the caller re-arranges for the new frame shape). Pure.
 */

/** Canvas = logical × scale + (dx, dy). */
export type Transform = { scale: number; dx: number; dy: number };

export const IDENTITY: Transform = { scale: 1, dx: 0, dy: 0 };

export function applyPoint(t: Transform, p: Point): Point {
  return { x: p.x * t.scale + t.dx, y: p.y * t.scale + t.dy };
}

export function applyRect(t: Transform, r: Rect): Rect {
  return {
    ...applyPoint(t, r),
    width: r.width * t.scale,
    height: r.height * t.scale,
  };
}

/** `outer` after `inner`: apply `inner` first. */
export function compose(outer: Transform, inner: Transform): Transform {
  return {
    scale: outer.scale * inner.scale,
    dx: inner.dx * outer.scale + outer.dx,
    dy: inner.dy * outer.scale + outer.dy,
  };
}

/** Everything an arranged board draws: rects, paths and guides. */
export function boundsOf(arranged: Arranged): Rect | undefined {
  const pathRects = [...arranged.paths.values()].flatMap((pts) => {
    const r = pointsRect(pts);
    return r ? [r] : [];
  });
  const guideRects = arranged.guides.flatMap((g) => {
    const r = pointsRect([g.from, g.to]);
    return r ? [r] : [];
  });
  return union([...arranged.rects.values(), ...pathRects, ...guideRects]);
}

/** The largest scale (at most `maxScale`) at which `bounds` fits `frame`, centred in it. */
export function fitTransform(bounds: Rect | undefined, frame: Rect, maxScale = 1): Transform {
  if (!bounds) return { scale: 1, dx: frame.x + frame.width / 2, dy: frame.y + frame.height / 2 };
  const sx = bounds.width > 0 ? frame.width / bounds.width : Infinity;
  const sy = bounds.height > 0 ? frame.height / bounds.height : Infinity;
  const scale = Math.min(maxScale, sx, sy);
  return {
    scale,
    dx: frame.x + (frame.width - bounds.width * scale) / 2 - bounds.x * scale,
    dy: frame.y + (frame.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

/** Canvas geometry to check against the avoid zones. */
export type Shapes = {
  rects: ReadonlyMap<string, Rect>;
  paths: ReadonlyMap<string, readonly Point[]>;
};

/** Keys of shapes that overlap an avoid zone (a path counts when it passes through one). */
export function avoidConflicts(shapes: Shapes, zones: readonly Zone[]): string[] {
  const hits: string[] = [];
  shapes.rects.forEach((r, key) => {
    if (!shapes.paths.has(key) && zones.some((z) => overlaps(r, z))) hits.push(key);
  });
  shapes.paths.forEach((pts, key) => {
    if (zones.some((z) => pathCrossesRect(pts, z, 0))) hits.push(key);
  });
  return hits;
}

/**
 * Translations that would move the conflicting rects out of the zones they hit: left, up, or
 * both, each the smallest that clears every hit. The caller checks them against the frame.
 */
export function slides(
  shapes: Shapes,
  zones: readonly Zone[],
  conflicts: readonly string[],
): Point[] {
  let left = 0;
  let up = 0;
  for (const key of conflicts) {
    const r = shapes.rects.get(key) ?? pointsRect(shapes.paths.get(key) ?? []);
    if (!r) continue;
    for (const z of zones) {
      if (!overlaps(r, z, 0)) continue;
      left = Math.max(left, right(r) - z.x);
      up = Math.max(up, bottom(r) - z.y);
    }
  }
  const step = (n: number) => Math.ceil(n) + 1;
  return [
    { x: -step(left), y: 0 },
    { x: 0, y: -step(up) },
    { x: -step(left), y: -step(up) },
  ];
}

/**
 * Parts of `frame` clear of the zones: the frame cut off at the leftmost zone's left edge, and
 * cut off at the highest zone's top edge (less `gap`). Empty parts are left out.
 */
export function clearFrames(frame: Rect, zones: readonly Zone[], gap: number): Rect[] {
  const hit = zones.filter((z) => overlaps(frame, z, 0));
  if (hit.length === 0) return [];
  const narrow = { ...frame, width: Math.min(...hit.map((z) => z.x)) - gap - frame.x };
  const short = { ...frame, height: Math.min(...hit.map((z) => z.y)) - gap - frame.y };
  return [narrow, short].filter((r) => r.width > 0 && r.height > 0);
}
