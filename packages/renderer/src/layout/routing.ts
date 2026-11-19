import { distance, type Point } from '../primitives/geometry.ts';
import type { Rect } from '../theme/index.ts';
import { bottom, centre, exitPoint, inflate, pathCrossesRect, right } from './rect.ts';

/**
 * Connector routing. A connector stays a straight edge-to-edge line when that line crosses no
 * other element box. Otherwise it is routed orthogonally: a small, fixed list of candidates
 * (a straight orthogonal line where the two ends overlap on one axis, two L-shapes, and Z-shapes
 * through every channel between box edges, the channels outside the board included, so going
 * around the outside is one of them), and the shortest that crosses nothing wins (each bend
 * costs a little; ties keep the earlier candidate). Corners are rounded. When nothing clears,
 * the straight line is kept and the layout reports `connector_crosses`. Pure and deterministic.
 */

export type RouteParams = {
  /** Space between a connector's end and the edge it leaves. */
  portGap: number;
  /** Space kept between a routed line and the boxes it passes. */
  clearance: number;
  /** Corner radius of a routed line. */
  cornerRadius: number;
};

export type Route = {
  /** The path to draw: corners rounded. */
  path: Point[];
  /**
   * Where a midpoint pin goes: the middle of the segment that holds the route's midpoint (before
   * rounding), with that segment's angle.
   */
  anchor: { point: Point; angle: number };
  /** False when no candidate cleared every obstacle (the straight line is kept). */
  clear: boolean;
};

/** Length a bend is worth, so a slightly longer route with fewer bends wins. */
const BEND_COST = 40;

/** Points along a rounded corner (excluding its two ends). */
const CORNER_SAMPLES = [0.25, 0.5, 0.75];

export function routeConnector(
  from: Rect,
  to: Rect,
  obstacles: readonly Rect[],
  params: RouteParams,
): Route {
  const straight = straightPath(from, to, params.portGap);
  if (!obstacles.some((o) => pathCrossesRect(straight, o))) return finish(straight, true, params);
  const blocked = [from, to, ...obstacles.map((o) => inflate(o, params.clearance))];
  const best = candidates(from, to, obstacles, params)
    .map((points) => simplify(points))
    .filter((points) => points.length >= 2 && !blocked.some((o) => pathCrossesRect(points, o)))
    .map((points, order) => ({ points, order, score: score(points) }))
    .sort((a, b) => a.score - b.score || a.order - b.order)[0];
  return best ? finish(best.points, true, params) : finish(straight, false, params);
}

/** From edge to edge along the line between the centres, `gap` short of each edge. */
export function straightPath(from: Rect, to: Rect, gap: number): Point[] {
  const a = centre(from);
  const b = centre(to);
  const start = exitPoint(from, a, b);
  const end = exitPoint(to, b, a);
  const length = distance(start, end);
  const backwards = distance(a, end) < distance(a, start);
  if (backwards || length <= 2 * gap) return [a, b];
  const k = gap / length;
  return [
    { x: start.x + (end.x - start.x) * k, y: start.y + (end.y - start.y) * k },
    { x: end.x - (end.x - start.x) * k, y: end.y - (end.y - start.y) * k },
  ];
}

type Side = 'top' | 'bottom' | 'left' | 'right';

/** The port on one side of a box at a given coordinate along that side, `gap` outside it. */
function port(r: Rect, side: Side, at: number, gap: number): Point {
  switch (side) {
    case 'top':
      return { x: at, y: r.y - gap };
    case 'bottom':
      return { x: at, y: bottom(r) + gap };
    case 'left':
      return { x: r.x - gap, y: at };
    case 'right':
      return { x: right(r) + gap, y: at };
  }
}

const vSide = (r: Rect, y: number): Side => (y < centre(r).y ? 'top' : 'bottom');
const hSide = (r: Rect, x: number): Side => (x < centre(r).x ? 'left' : 'right');

/** Every orthogonal candidate, in a fixed order. */
function candidates(
  from: Rect,
  to: Rect,
  obstacles: readonly Rect[],
  { portGap: g }: RouteParams,
): Point[][] {
  const a = centre(from);
  const b = centre(to);
  const list: Point[][] = [];
  // A straight orthogonal line where the two boxes overlap on one axis.
  const x0 = Math.max(from.x, to.x);
  const x1 = Math.min(right(from), right(to));
  if (x1 > x0) {
    const x = (x0 + x1) / 2;
    list.push([port(from, vSide(from, b.y), x, g), port(to, vSide(to, a.y), x, g)]);
  }
  const y0 = Math.max(from.y, to.y);
  const y1 = Math.min(bottom(from), bottom(to));
  if (y1 > y0) {
    const y = (y0 + y1) / 2;
    list.push([port(from, hSide(from, b.x), y, g), port(to, hSide(to, a.x), y, g)]);
  }
  // L-shapes: across then down, and down then across.
  list.push([
    port(from, hSide(from, b.x), a.y, g),
    { x: b.x, y: a.y },
    port(to, vSide(to, a.y), b.x, g),
  ]);
  list.push([
    port(from, vSide(from, b.y), a.x, g),
    { x: a.x, y: b.y },
    port(to, hSide(to, a.x), b.y, g),
  ]);
  // Z-shapes (and U-shapes around the outside) through each channel.
  const boxes = [from, to, ...obstacles];
  for (const y of channels(
    boxes.flatMap((r) => [r.y, bottom(r)]),
    g,
  )) {
    list.push([
      port(from, vSide(from, y), a.x, g),
      { x: a.x, y },
      { x: b.x, y },
      port(to, vSide(to, y), b.x, g),
    ]);
  }
  for (const x of channels(
    boxes.flatMap((r) => [r.x, right(r)]),
    g,
  )) {
    list.push([
      port(from, hSide(from, x), a.y, g),
      { x, y: a.y },
      { x, y: b.y },
      port(to, hSide(to, x), b.y, g),
    ]);
  }
  return list;
}

/**
 * Lines a route may run along: midway between each pair of neighbouring box edges, and one just
 * outside the outermost edges on each side (going around the board).
 */
function channels(edges: readonly number[], gap: number): number[] {
  const sorted = [...new Set(edges.map((e) => Math.round(e * 100) / 100))].sort((p, q) => p - q);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) return [];
  const mids = sorted.slice(1).map((e, i) => (e + (sorted[i] ?? e)) / 2);
  return [...mids, first - 4 * gap, last + 4 * gap];
}

/** Drops repeated points and points in the middle of a straight run. */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const before = out.at(-2);
    if (before && last && collinear(before, last, p)) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

function collinear(a: Point, b: Point, c: Point): boolean {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 0.01;
}

function score(points: readonly Point[]): number {
  return length(points) + BEND_COST * Math.max(0, points.length - 2);
}

function length(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += distance(a, b);
  }
  return total;
}

function finish(points: Point[], clear: boolean, params: RouteParams): Route {
  return { path: roundCorners(points, params.cornerRadius), anchor: midSegment(points), clear };
}

/** The middle of the segment holding the polyline's midpoint, and that segment's angle. */
export function midSegment(points: readonly Point[]): { point: Point; angle: number } {
  const half = length(points) / 2;
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const d = distance(a, b);
    if (walked + d >= half || i === points.length - 1) {
      return {
        point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    walked += d;
  }
  return { point: points[0] ?? { x: 0, y: 0 }, angle: 0 };
}

/** Each inner corner replaced by a short curve of radius `r` (less on short segments). */
export function roundCorners(points: readonly Point[], r: number): Point[] {
  if (points.length < 3 || r <= 0) return [...points];
  const first = points[0];
  const out: Point[] = first ? [first] : [];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    if (!prev || !corner || !next) continue;
    const k = Math.min(r, distance(prev, corner) / 2, distance(corner, next) / 2);
    const enter = towards(corner, prev, k);
    const leave = towards(corner, next, k);
    out.push(enter);
    for (const t of CORNER_SAMPLES) out.push(quadratic(enter, corner, leave, t));
    out.push(leave);
  }
  const last = points.at(-1);
  if (last) out.push(last);
  return out;
}

function towards(from: Point, to: Point, by: number): Point {
  const d = distance(from, to);
  if (d === 0) return from;
  return { x: from.x + ((to.x - from.x) * by) / d, y: from.y + ((to.y - from.y) * by) / d };
}

function quadratic(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}
