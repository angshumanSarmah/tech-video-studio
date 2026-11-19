import {
  catmullRom,
  distance,
  lerpPoint,
  partialPolyline,
  pointAlong,
  polylineLength,
  smoothstep,
  type Point,
} from '../geometry.ts';
import type { Size } from '../types.ts';

/**
 * Where a route's stops and path go inside its box, from the stop count alone: stops spread left
 * to right at alternating heights, joined by street-like (horizontal, then vertical) legs. The
 * layout engine (P1A.9) may later snap stops to places on a map.
 */

/** Height of each stop as a fraction of the inner box (top 0, bottom 1), by stop index. */
const STOP_Y = [0.78, 0.22, 0.62, 0.12, 0.7, 0.3];

/** Seconds the route takes to draw after `move`: fixed, never paced by the beat. */
export const ROUTE_DRAW_SEC = 1.5;

/** Seconds a jumpy mover takes to hop from one stop to the next. */
export const HOP_SEC = 0.3;

export const ROUTE_MODES = ['jumpy', 'smooth'] as const;
export type RouteMode = (typeof ROUTE_MODES)[number];

export type RouteLayout = {
  stops: Point[];
  /** Street-like legs (no mode). */
  path: Point[];
  /** Fraction of the path's length at which each stop is reached. */
  stopAt: number[];
  /** A smooth curve through the stops (`smooth`, or `jumpy` after `morph`). */
  curve: Point[];
  curveStopAt: number[];
  /**
   * Whether each stop's label goes above it: legs leave a stop sideways and arrive vertically, so
   * the label goes on the side the route does not arrive from (below for the first stop).
   */
  labelAbove: boolean[];
};

export function routeLayout(
  count: number,
  box: Size,
  inset: { x: number; y: number },
): RouteLayout {
  const inner = { width: box.width - 2 * inset.x, height: box.height - 2 * inset.y };
  const stops = Array.from({ length: count }, (_, i) => ({
    x: inset.x + (count > 1 ? (inner.width * i) / (count - 1) : inner.width / 2),
    y: inset.y + inner.height * (STOP_Y[i % STOP_Y.length] ?? 0.5),
  }));
  const path: Point[] = [];
  stops.forEach((stop, i) => {
    const prev = stops[i - 1];
    if (prev) path.push({ x: stop.x, y: prev.y });
    path.push(stop);
  });
  const labelAbove = stops.map((stop, i) => (stops[i - 1]?.y ?? -Infinity) > stop.y);
  const curve = catmullRom(stops);
  return {
    stops,
    path,
    stopAt: stopFractions(stops, path),
    curve,
    curveStopAt: stopFractions(stops, curve),
    labelAbove,
  };
}

function stopFractions(stops: readonly Point[], path: readonly Point[]): number[] {
  const total = polylineLength(path);
  let walked = 0;
  let next = 0;
  const at: number[] = [];
  path.forEach((point, i) => {
    const prev = path[i - 1];
    if (prev) walked += distance(prev, point);
    if (stops[next] === point) {
      at.push(total > 0 ? walked / total : 0);
      next += 1;
    }
  });
  return at;
}

/** Drawn fraction of the route: fully drawn without `move`, else eased over `ROUTE_DRAW_SEC`. */
export function routeDraw(moveElapsed: number | undefined): number {
  return moveElapsed === undefined ? 1 : smoothstep(moveElapsed / ROUTE_DRAW_SEC);
}

/** What drives the route at a frame, read from the element state. */
export type RouteMotion = {
  /** Seconds since the latest `move`; 0 while the first is ahead; undefined without one. */
  moveElapsed: number | undefined;
  /** Started `move` occurrences. */
  moves: number;
  /** Seconds since `morph` once it has started; undefined before (or without) it. */
  morphElapsed: number | undefined;
};

/** What a route shows at a frame. */
export type RouteView = {
  /** The solid line drawn so far (empty when nothing is drawn). */
  line: Point[];
  /** Drawn fraction of the solid line: the distance tag lands near 1. */
  draw: number;
  /** Jumpy only: straight dashed hops so far, and their opacity (fades as the curve draws). */
  trail: Point[];
  trailOpacity: number;
  /** Where the mover is (undefined: not shown yet). */
  mover: Point | undefined;
  /** Whether each stop has been reached (filled). */
  reached: boolean[];
};

/**
 * Street mode (no `mode`) draws the legs on `move`; `smooth` draws the curve on `move`; `jumpy`
 * steps the mover one stop per `move` (dashed hops behind it) until `morph`, which draws the curve
 * while the mover glides along it from the start. The mover rides the head of whatever is drawing.
 */
export function routeView(
  layout: RouteLayout,
  mode: RouteMode | undefined,
  motion: RouteMotion,
): RouteView {
  if (mode === 'jumpy') {
    const jumps = jumpyView(layout, motion);
    if (motion.morphElapsed === undefined) return jumps;
    const drawn = drawnView(layout.curve, layout.curveStopAt, routeDraw(motion.morphElapsed));
    return { ...drawn, trail: jumps.trail, trailOpacity: 1 - drawn.draw };
  }
  const draw = routeDraw(motion.moveElapsed);
  return mode === 'smooth'
    ? drawnView(layout.curve, layout.curveStopAt, draw)
    : drawnView(layout.path, layout.stopAt, draw);
}

function drawnView(path: readonly Point[], stopAt: readonly number[], draw: number): RouteView {
  const first = stopAt.length - 1;
  return {
    line: draw > 0 ? partialPolyline(path, draw) : [],
    draw,
    trail: [],
    trailOpacity: 0,
    mover: pointAlong(path, draw).point,
    reached: stopAt.map((at, i) => i === 0 || i === first || draw >= at),
  };
}

/** The mover hops to stop `moves` (capped at the last); the hops so far stay as a dashed trail. */
function jumpyView(layout: RouteLayout, motion: RouteMotion): RouteView {
  const { stops } = layout;
  const last = stops.length - 1;
  const target = Math.min(motion.moves, last);
  const hop =
    target === 0 || motion.moves > last ? 1 : smoothstep((motion.moveElapsed ?? 0) / HOP_SEC);
  const from = stops[Math.max(0, target - 1)];
  const to = stops[target];
  const mover = from && to ? (target > 0 ? lerpPoint(from, to, hop) : to) : undefined;
  const trail = mover ? [...stops.slice(0, target), mover] : [];
  return {
    line: [],
    draw: 0,
    trail: target > 0 ? trail : [],
    trailOpacity: 1,
    mover,
    reached: stops.map((_, i) => i < target || (i === target && hop >= 1)),
  };
}

/** Jumpy routes step once per `move`: moves past the last stop do nothing. */
export function excessMoves(stopCount: number, moves: number): number {
  return Math.max(0, moves - (stopCount - 1));
}
