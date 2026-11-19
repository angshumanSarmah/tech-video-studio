import type { Size } from './types.ts';

/**
 * Polyline helpers for primitives drawn along a path (`connector`, `packet_stream`,
 * `route_path`). Pure and React-free. Points are px in the element's own box.
 */

export type Point = { x: number; y: number };

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += distance(a, b);
  }
  return total;
}

/** Point at fraction `t` (0..1, clamped) of the path's length, with its segment's angle in radians. */
export function pointAlong(points: readonly Point[], t: number): { point: Point; angle: number } {
  const first = points[0] ?? { x: 0, y: 0 };
  let remaining = clamp01(t) * polylineLength(points);
  let last = { point: first, angle: 0 };
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const length = distance(a, b);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (length > 0 && remaining <= length) {
      const f = remaining / length;
      return { point: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, angle };
    }
    remaining -= length;
    last = { point: b, angle };
  }
  return last;
}

/** The path from its start up to fraction `t` of its length (just the start point at 0). */
export function partialPolyline(points: readonly Point[], t: number): Point[] {
  const first = points[0];
  if (!first) return [];
  const target = clamp01(t) * polylineLength(points);
  const out: Point[] = [first];
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const length = distance(a, b);
    if (walked + length >= target) {
      const f = length > 0 ? (target - walked) / length : 0;
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      return out;
    }
    out.push(b);
    walked += length;
  }
  return out;
}

/**
 * A smooth curve through `points` (uniform Catmull-Rom), sampled into a
 * polyline with `samples` points per segment. The input points themselves (the same objects)
 * stay on the curve, so callers can find where each one is reached.
 */
export function catmullRom(points: readonly Point[], samples = 16): Point[] {
  if (points.length < 3) return [...points];
  const out: Point[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (!p1 || !p2) continue;
    const p0 = points[i - 1] ?? p1;
    const p3 = points[i + 2] ?? p2;
    out.push(p1);
    for (let k = 1; k < samples; k += 1) out.push(catmullRomAt(p0, p1, p2, p3, k / samples));
  }
  const last = points.at(-1);
  if (last) out.push(last);
  return out;
}

function catmullRomAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  const axis = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
  return { x: axis(p0.x, p1.x, p2.x, p3.x), y: axis(p0.y, p1.y, p2.y, p3.y) };
}

/** The point at fraction `t` (0..1, clamped) of the straight line from `a` to `b`. */
export function lerpPoint(a: Point, b: Point, t: number): Point {
  const c = clamp01(t);
  return { x: a.x + (b.x - a.x) * c, y: a.y + (b.y - a.y) * c };
}

/** SVG path data for a polyline. */
export function pathD(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ');
}

/** SVG `points` for a polygon. */
export function svgPoints(points: readonly Point[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

/**
 * The path of a relational primitive that stands alone (sheets; the layout gives it a `path` on a
 * board): a straight left-to-right line through the middle of the box, `inset` px from each side.
 */
export function standalonePath(box: Size, inset: number): Point[] {
  const y = box.height / 2;
  return [
    { x: inset, y },
    { x: Math.max(inset, box.width - inset), y },
  ];
}

/**
 * Triangle of an arrowhead whose tip is at `tip`, pointing along `angle` (radians); `size` is its
 * length, and its base is as wide.
 */
export function arrowHead(tip: Point, angle: number, size: number): Point[] {
  const back = { x: tip.x - size * Math.cos(angle), y: tip.y - size * Math.sin(angle) };
  const half = size / 2;
  const nx = -Math.sin(angle) * half;
  const ny = Math.cos(angle) * half;
  return [tip, { x: back.x + nx, y: back.y + ny }, { x: back.x - nx, y: back.y - ny }];
}

/** Ease-in-out (smoothstep) of `t`, clamped to 0..1: for things that travel or draw. */
export function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
