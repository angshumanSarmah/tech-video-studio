import type { Point } from '../primitives/geometry.ts';
import type { Size } from '../primitives/types.ts';
import type { Rect } from '../theme/index.ts';
import { union } from './rect.ts';

/**
 * Blocks: groups of placed rects with their origin at (0, 0), composed into rows, columns and
 * wrapped rows. Layout modes build their arrangement from blocks in logical px (scale 1); the
 * fit step scales the result into the frame. Pure.
 */

export type Block = {
  rects: ReadonlyMap<string, Rect>;
  width: number;
  height: number;
  /** Lines the scene draws faintly (swimlane lifelines, the versus divider), in block px. */
  guides: readonly Guide[];
  /** Paths a mode routes itself (swimlane messages), by connector key, in block px. */
  routes: ReadonlyMap<string, readonly Point[]>;
};

export type Guide = { from: Point; to: Point };

export const EMPTY_BLOCK: Block = {
  rects: new Map(),
  width: 0,
  height: 0,
  guides: [],
  routes: new Map(),
};

export function isEmpty(block: Block): boolean {
  return block.rects.size === 0 && block.guides.length === 0 && block.routes.size === 0;
}

export function single(key: string, size: Size): Block {
  return { ...EMPTY_BLOCK, rects: new Map([[key, { x: 0, y: 0, ...size }]]), ...size };
}

/** Moves every rect, guide and route of a block by (dx, dy). */
export function shift(block: Block, dx: number, dy: number): Block {
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...block,
    rects: new Map([...block.rects].map(([k, r]) => [k, { ...r, x: r.x + dx, y: r.y + dy }])),
    guides: block.guides.map((g) => ({ from: move(g.from), to: move(g.to) })),
    routes: new Map([...block.routes].map(([k, pts]) => [k, pts.map(move)])),
  };
}

/** Merges blocks already positioned in one space, then moves the result to the origin. */
export function combine(blocks: readonly Block[], extraGuides: readonly Guide[] = []): Block {
  const rects = new Map<string, Rect>();
  const routes = new Map<string, readonly Point[]>();
  const guides: Guide[] = [...extraGuides];
  for (const b of blocks) {
    b.rects.forEach((r, k) => rects.set(k, r));
    b.routes.forEach((p, k) => routes.set(k, p));
    guides.push(...b.guides);
  }
  const box = union([
    ...rects.values(),
    ...guides.flatMap((g) => [pointRect(g.from), pointRect(g.to)]),
    ...[...routes.values()].flatMap((pts) => pts.map(pointRect)),
  ]);
  if (!box) return EMPTY_BLOCK;
  const merged: Block = { rects, guides, routes, width: box.width, height: box.height };
  return shift(merged, -box.x, -box.y);
}

const pointRect = (p: Point): Rect => ({ x: p.x, y: p.y, width: 0, height: 0 });

/** Blocks side by side (left to right), centred on a shared horizontal axis. */
export function row(blocks: readonly Block[], gap: number): Block {
  const parts = blocks.filter((b) => !isEmpty(b));
  const height = Math.max(0, ...parts.map((b) => b.height));
  let x = 0;
  const placed = parts.map((b) => {
    const moved = shift(b, x, (height - b.height) / 2);
    x += b.width + gap;
    return moved;
  });
  return combine(placed);
}

/** Blocks stacked top to bottom, centred on a shared vertical axis. */
export function column(blocks: readonly Block[], gap: number | GapAfter): Block {
  const parts = blocks.filter((b) => !isEmpty(b));
  const width = Math.max(0, ...parts.map((b) => b.width));
  const after = typeof gap === 'number' ? () => gap : gap;
  let y = 0;
  const placed = parts.map((b, i) => {
    const moved = shift(b, (width - b.width) / 2, y);
    y += b.height + after(b, parts[i + 1]);
    return moved;
  });
  return combine(placed);
}

/** The space after `block` in a column, given the block below it (none after the last). */
export type GapAfter = (block: Block, next: Block | undefined) => number;

/** Rows of blocks no wider than `maxWidth` (a block wider than that gets a row of its own). */
export function wrap(blocks: readonly Block[], maxWidth: number, gap: number): Block {
  const rows: Block[][] = [];
  let current: Block[] = [];
  let width = 0;
  for (const b of blocks.filter((x) => !isEmpty(x))) {
    const next = current.length === 0 ? b.width : width + gap + b.width;
    if (current.length > 0 && next > maxWidth) {
      rows.push(current);
      current = [b];
      width = b.width;
    } else {
      current.push(b);
      width = next;
    }
  }
  if (current.length > 0) rows.push(current);
  return column(
    rows.map((r) => row(r, gap)),
    gap,
  );
}

/** A block of absolutely positioned rects (e.g. on a ring), moved to the origin. */
export function fromRects(rects: ReadonlyMap<string, Rect>): Block {
  return combine([{ ...EMPTY_BLOCK, rects }]);
}
