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

/** SVG path data for a polyline. */
export function pathD(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ');
}

/** SVG `points` for a polygon. */
export function svgPoints(points: readonly Point[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

/**
 * TEMPORARY until the layout engine (P1A.9) supplies real endpoints: a straight left-to-right
 * line through the middle of the box, `inset` px from each side.
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
