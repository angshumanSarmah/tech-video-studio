import { smoothstep } from '../geometry.ts';

/**
 * Geometry of a `segmented_time_bar`: segment widths proportional to their time, but never
 * narrower than their labels need, and a piecewise-linear map from seconds to x that stays
 * consistent with those widths (so a budget marker lands inside the right segment).
 */

/**
 * Widths summing to `total`, proportional to `values`, each at least its `mins` entry. Segments
 * pinned at their minimum give up no more; the rest share what is left in proportion. When the
 * minimums alone exceed `total`, the minimums are returned (the size hints prevent that).
 */
export function segmentWidths(
  values: readonly number[],
  mins: readonly number[],
  total: number,
): number[] {
  const pinned = new Set<number>();
  for (let round = 0; round <= values.length; round += 1) {
    const free = values.reduce((sum, v, i) => (pinned.has(i) ? sum : sum + v), 0);
    const room = total - [...pinned].reduce((sum, i) => sum + (mins[i] ?? 0), 0);
    const widths = values.map((v, i) =>
      pinned.has(i) ? (mins[i] ?? 0) : free > 0 ? (v / free) * room : 0,
    );
    const short = widths.findIndex((w, i) => !pinned.has(i) && w < (mins[i] ?? 0));
    if (short < 0) return widths;
    widths.forEach((w, i) => {
      if (!pinned.has(i) && w < (mins[i] ?? 0)) pinned.add(i);
    });
  }
  return mins.slice(0, values.length);
}

/** Left edge of each segment: the sum of the widths before it. */
export function segmentStarts(widths: readonly number[]): number[] {
  let x = 0;
  return widths.map((w) => {
    const start = x;
    x += w;
    return start;
  });
}

/** x (from the bar's left) of a moment `sec` into the stacked segments. */
export function timeToX(sec: number, values: readonly number[], widths: readonly number[]): number {
  let x = 0;
  let t = sec;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] ?? 0;
    const w = widths[i] ?? 0;
    if (t <= v) return x + (v > 0 ? (t / v) * w : 0);
    t -= v;
    x += w;
  }
  return x;
}

/** Seconds to fill each segment on `enter`, capped so many segments still fill quickly. */
const FILL_SEC = 0.35;
const FILL_MAX_SEC = 1.5;

/** Fill (0..1) of each segment: all full without `enter`, else left to right after it. */
export function segmentFills(count: number, enterElapsed: number | undefined): number[] {
  if (enterElapsed === undefined) return Array.from({ length: count }, () => 1);
  const per = Math.min(FILL_SEC, FILL_MAX_SEC / Math.max(1, count));
  return Array.from({ length: count }, (_, i) => smoothstep((enterElapsed - i * per) / per));
}
