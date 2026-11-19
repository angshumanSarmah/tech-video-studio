import { distance, type Point } from '../geometry.ts';
import type { Size } from '../types.ts';

/**
 * Shapes of a `zone_polygon`'s zones inside its box, from the zone count alone: irregular,
 * deterministic heptagons around fixed centres. With `overlap`, neighbours share a band; without,
 * they keep a gap. The layout engine (P1A.9) may later place them over a map.
 */

/** Zone centres as fractions of the box, by zone count. */
const CENTRES: Record<number, readonly [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.34, 0.5],
    [0.66, 0.5],
  ],
  3: [
    [0.32, 0.34],
    [0.68, 0.34],
    [0.5, 0.68],
  ],
  4: [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.3, 0.7],
    [0.7, 0.7],
  ],
  5: [
    [0.25, 0.26],
    [0.75, 0.26],
    [0.5, 0.5],
    [0.25, 0.74],
    [0.75, 0.74],
  ],
  6: [
    [0.2, 0.32],
    [0.5, 0.32],
    [0.8, 0.32],
    [0.2, 0.68],
    [0.5, 0.68],
    [0.8, 0.68],
  ],
};

/** Per-vertex radius factors; each zone starts at a different offset, so no two look alike. */
const JITTER = [1, 0.84, 0.97, 0.88, 1.03, 0.9, 0.95];

/** Radius as a fraction of the distance to the nearest neighbour. */
const OVERLAP_RADIUS = 0.68;
const GAP_RADIUS = 0.44;

export type ZoneShape = { centre: Point; points: Point[] };

export const MAX_ZONES = 6;

export function zoneShapes(count: number, box: Size, overlap: boolean): ZoneShape[] {
  const fractions = CENTRES[Math.min(MAX_ZONES, Math.max(1, count))] ?? [];
  const centres = fractions.map(([fx, fy]) => ({ x: fx * box.width, y: fy * box.height }));
  return centres.map((centre, i) => {
    const r = zoneRadius(centre, centres, box, overlap);
    return { centre, points: polygon(centre, r, i) };
  });
}

function zoneRadius(centre: Point, centres: readonly Point[], box: Size, overlap: boolean): number {
  const nearest = Math.min(
    ...centres.filter((c) => c !== centre).map((c) => distance(c, centre)),
    Math.min(box.width, box.height),
  );
  const wanted = nearest * (overlap || centres.length === 1 ? OVERLAP_RADIUS : GAP_RADIUS);
  // Keep the largest vertex (jitter up to 1.03) inside the box.
  const room = Math.min(centre.x, box.width - centre.x, centre.y, box.height - centre.y) / 1.03;
  return Math.min(wanted, room);
}

function polygon(centre: Point, r: number, index: number): Point[] {
  return JITTER.map((_, k) => {
    const factor = JITTER[(k + index * 3) % JITTER.length] ?? 1;
    const angle = (2 * Math.PI * k) / JITTER.length - Math.PI / 2 + index * 0.4;
    return {
      x: centre.x + r * factor * Math.cos(angle),
      y: centre.y + r * factor * Math.sin(angle),
    };
  });
}
