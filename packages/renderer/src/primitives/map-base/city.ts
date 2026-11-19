import { distance, type Point } from '../geometry.ts';
import type { Size } from '../types.ts';

/**
 * A stylised top-down city for `map_base`: streets on a jittered grid (every third one an
 * avenue), blocks between them (some split, some parks) and, for `riverside`, a river with no
 * blocks on it. Seeded per variant, so the same variant always draws the same city.
 */

export const MAP_VARIANTS = ['downtown', 'suburb', 'riverside'] as const;
export type MapVariant = (typeof MAP_VARIANTS)[number];

type VariantRules = { seed: number; block: number; park: number; split: number; river: boolean };

const RULES: Record<MapVariant, VariantRules> = {
  downtown: { seed: 11, block: 96, park: 0.06, split: 0.45, river: false },
  suburb: { seed: 23, block: 150, park: 0.22, split: 0.15, river: false },
  riverside: { seed: 37, block: 116, park: 0.12, split: 0.3, river: true },
};

/** Street and avenue widths in px. */
export const STREET = 14;
export const AVENUE = 26;

/** River band width in px. */
export const RIVER_WIDTH = 70;

export type Street = { from: Point; to: Point; avenue: boolean };
export type Block = { x: number; y: number; width: number; height: number; park: boolean };
export type CityMap = { streets: Street[]; blocks: Block[]; river: Point[] };

export function cityMap(variant: MapVariant, box: Size): CityMap {
  const rules = RULES[variant];
  const random = mulberry32(rules.seed);
  const xs = streetLines(box.width, rules.block, random);
  const ys = streetLines(box.height, rules.block, random);
  const river = rules.river ? riverPath(box) : [];
  const streets = [
    ...xs.map((x, i) => ({ from: { x, y: 0 }, to: { x, y: box.height }, avenue: i % 3 === 1 })),
    ...ys.map((y, i) => ({ from: { x: 0, y }, to: { x: box.width, y }, avenue: i % 3 === 1 })),
  ];
  const blocks = cells(xs, ys, box)
    .flatMap((cell) => maybeSplit(cell, rules.split, random))
    .map((cell) => ({ ...cell, park: random() < rules.park }))
    .filter((block) => !onRiver(block, river));
  return { streets, blocks, river };
}

/** Street positions across `length`: about one block apart, jittered ±20 %. */
function streetLines(length: number, block: number, random: () => number): number[] {
  const lines: number[] = [];
  let at = block * (0.4 + 0.3 * random());
  while (at < length - block * 0.3) {
    lines.push(Math.round(at));
    at += block * (0.8 + 0.4 * random());
  }
  return lines;
}

type Cell = Omit<Block, 'park'>;

/** Blocks between neighbouring streets (and the box edges), inset by half a street. */
function cells(xs: readonly number[], ys: readonly number[], box: Size): Cell[] {
  const edgesX = [0, ...xs, box.width];
  const edgesY = [0, ...ys, box.height];
  const out: Cell[] = [];
  for (let i = 1; i < edgesX.length; i += 1) {
    for (let j = 1; j < edgesY.length; j += 1) {
      const x0 = (edgesX[i - 1] ?? 0) + (i > 1 ? STREET / 2 : 0);
      const x1 = (edgesX[i] ?? 0) - (i < edgesX.length - 1 ? STREET / 2 : 0);
      const y0 = (edgesY[j - 1] ?? 0) + (j > 1 ? STREET / 2 : 0);
      const y1 = (edgesY[j] ?? 0) - (j < edgesY.length - 1 ? STREET / 2 : 0);
      if (x1 - x0 > STREET && y1 - y0 > STREET)
        out.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    }
  }
  return out;
}

/** Splits a block in two along its longer side by a lane, with probability `chance`. */
function maybeSplit(cell: Cell, chance: number, random: () => number): Cell[] {
  if (random() >= chance) return [cell];
  const lane = STREET / 2;
  if (cell.width >= cell.height) {
    const w = (cell.width - lane) / 2;
    return [
      { ...cell, width: w },
      { ...cell, x: cell.x + w + lane, width: w },
    ];
  }
  const h = (cell.height - lane) / 2;
  return [
    { ...cell, height: h },
    { ...cell, y: cell.y + h + lane, height: h },
  ];
}

/** A gentle S-curve from the left edge to the right edge. */
function riverPath(box: Size): Point[] {
  const steps = 12;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return { x: t * box.width, y: box.height * (0.42 + 0.14 * Math.sin(t * Math.PI * 1.6)) };
  });
}

/** Whether any part of the block comes within the river's half-width of its centre line. */
function onRiver(block: Cell, river: readonly Point[]): boolean {
  if (river.length === 0) return false;
  const corners = [
    { x: block.x, y: block.y },
    { x: block.x + block.width, y: block.y },
    { x: block.x, y: block.y + block.height },
    { x: block.x + block.width, y: block.y + block.height },
    { x: block.x + block.width / 2, y: block.y + block.height / 2 },
  ];
  return river.some((p, i) => {
    const prev = river[i - 1];
    if (!prev) return false;
    if (crossesSegment(block, prev, p)) return true;
    return corners.some((c) => distanceToSegment(c, prev, p) < RIVER_WIDTH / 2 + STREET / 2);
  });
}

function crossesSegment(block: Cell, a: Point, b: Point): boolean {
  const xMin = Math.min(a.x, b.x);
  const xMax = Math.max(a.x, b.x);
  if (xMax < block.x || xMin > block.x + block.width) return false;
  const mid = (Math.max(xMin, block.x) + Math.min(xMax, block.x + block.width)) / 2;
  const t = b.x === a.x ? 0 : (mid - a.x) / (b.x - a.x);
  const y = a.y + (b.y - a.y) * t;
  return y >= block.y && y <= block.y + block.height;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const length2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (length2 === 0) return distance(p, a);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length2),
  );
  return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

/** Small seeded PRNG (mulberry32): the same seed always gives the same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
