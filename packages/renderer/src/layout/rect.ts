import type { Point } from '../primitives/geometry.ts';
import type { Size } from '../primitives/types.ts';
import type { Rect } from '../theme/index.ts';

/** Rect and point helpers for the layout engine. Pure; px in whatever space the caller uses. */

export const right = (r: Rect) => r.x + r.width;
export const bottom = (r: Rect) => r.y + r.height;
export const centre = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function rectAt(c: Point, size: Size): Rect {
  return { x: c.x - size.width / 2, y: c.y - size.height / 2, ...size };
}

export function translate(r: Rect, dx: number, dy: number): Rect {
  return { ...r, x: r.x + dx, y: r.y + dy };
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

/** Smallest rect holding every rect; undefined for none. */
export function union(rects: readonly Rect[]): Rect | undefined {
  const [first, ...rest] = rects;
  if (!first) return undefined;
  let x0 = first.x;
  let y0 = first.y;
  let x1 = right(first);
  let y1 = bottom(first);
  for (const r of rest) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, right(r));
    y1 = Math.max(y1, bottom(r));
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Bounding rect of a polyline. */
export function pointsRect(points: readonly Point[]): Rect | undefined {
  return union(points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })));
}

/** Positive-area overlap (touching edges do not count), with `epsilon` px of tolerance. */
export function overlaps(a: Rect, b: Rect, epsilon = 0.5): boolean {
  return (
    Math.min(right(a), right(b)) - Math.max(a.x, b.x) > epsilon &&
    Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y) > epsilon
  );
}

/** `inner` lies inside `outer`, with `epsilon` px of tolerance for rounding. */
export function inside(outer: Rect, inner: Rect, epsilon = 0.5): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    right(inner) <= right(outer) + epsilon &&
    bottom(inner) <= bottom(outer) + epsilon
  );
}

/**
 * Where the segment from `a` towards `b` leaves rect `r` (a is assumed inside r, e.g. its centre).
 * Returns `a` when b is inside r too.
 */
export function exitPoint(r: Rect, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tx = dx > 0 ? (right(r) - a.x) / dx : dx < 0 ? (r.x - a.x) / dx : Infinity;
  const ty = dy > 0 ? (bottom(r) - a.y) / dy : dy < 0 ? (r.y - a.y) / dy : Infinity;
  const t = Math.min(tx, ty, 1);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** True when the segment a→b passes through the interior of `r` (Liang–Barsky clipping). */
export function segmentCrossesRect(a: Point, b: Point, r: Rect, epsilon = 1): boolean {
  const inner = inflate(r, -epsilon);
  if (inner.width <= 0 || inner.height <= 0) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - inner.x],
    [dx, right(inner) - a.x],
    [-dy, a.y - inner.y],
    [dy, bottom(inner) - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return t1 - t0 > 1e-9;
}

/** The polyline passes through the interior of `r` on any segment. */
export function pathCrossesRect(points: readonly Point[], r: Rect, epsilon = 1): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b && segmentCrossesRect(a, b, r, epsilon)) return true;
  }
  return false;
}
