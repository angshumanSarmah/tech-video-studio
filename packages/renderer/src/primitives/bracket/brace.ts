import type { Point } from '../geometry.ts';

/**
 * A horizontal curly brace as a polyline, so it can draw on with `partialPolyline`: it opens
 * upward (toward the group above it) and points down at its label. Pure.
 */

const ARC_SAMPLES = 6;

/** Brace `width` px wide and `depth` px from its ends (y = 0) to its tip (y = depth). */
export function bracePoints(width: number, depth: number): Point[] {
  const r = Math.min(depth / 2, width / 4);
  const mid = width / 2;
  const left = [
    ...arc({ x: r, y: 0 }, r, Math.PI, Math.PI / 2),
    ...arc({ x: mid - r, y: 2 * r }, r, -Math.PI / 2, 0),
  ];
  const right = left.map((p) => ({ x: width - p.x, y: p.y })).reverse();
  return [...left, ...right.slice(1)];
}

/** Points on a circle around `c` from angle `from` to `to` (radians, y down). */
function arc(c: Point, r: number, from: number, to: number): Point[] {
  return Array.from({ length: ARC_SAMPLES + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / ARC_SAMPLES;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}
