import { distance, polylineLength, smoothstep, type Point } from '../geometry.ts';
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

export type RouteLayout = {
  stops: Point[];
  path: Point[];
  /** Fraction of the path's length at which each stop is reached. */
  stopAt: number[];
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
  return { stops, path, stopAt: stopFractions(stops, path), labelAbove };
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
