import type { Size } from '../primitives/types.ts';
import { column, combine, EMPTY_BLOCK, row, shift, single, type Block } from './blocks.ts';
import type { SceneItem } from './analyse.ts';
import type { ItemRole } from './types.ts';

/**
 * Clusters: a unit (a solid or background element) with everything pinned to its sides, so the
 * layout mode places them as one block and room for the pins is reserved up front. A pin sits
 * `gap` from its host's side, centred on it; several pins on one side line up (rows on top and
 * bottom, columns left and right); pins of pins nest. A span (a bracket) reserves room under the
 * last element it spans. Midpoint pins follow connectors and are placed later. Pure.
 */

export type Cluster = { block: Block };

type SideBlocks = { top: Block[]; bottom: Block[]; left: Block[]; right: Block[] };

const UNIT_ROLES: readonly ItemRole[] = ['solid', 'background'];

export function clusterBlocks(
  items: readonly SceneItem[],
  gap: number,
): ReadonlyMap<string, Cluster> {
  const attached = attachments(items);
  const byKey = new Map(items.map((i) => [i.key, i]));
  const build = (key: string, depth: number): Block => {
    const item = byKey.get(key);
    if (!item) return EMPTY_BLOCK;
    const size: Size = {
      width: item.size.width * item.boost,
      height: item.size.height * item.boost,
    };
    const sides: SideBlocks = { top: [], bottom: [], left: [], right: [] };
    if (depth <= items.length) {
      for (const { key: child, side } of attached.get(key) ?? []) {
        sides[side].push(build(child, depth + 1));
      }
    }
    return around(single(key, size), sides, gap);
  };
  return new Map(
    items
      .filter((i) => UNIT_ROLES.includes(i.role))
      .map((i) => [i.key, { block: build(i.key, 0) }]),
  );
}

type Attachment = { key: string; side: keyof SideBlocks };

/** What sits on each item's sides: its side pins, and spans reserved under their last target. */
function attachments(items: readonly SceneItem[]): Map<string, Attachment[]> {
  const result = new Map<string, Attachment[]>();
  const add = (host: string, a: Attachment) => result.set(host, [...(result.get(host) ?? []), a]);
  for (const item of items) {
    if (item.pin && item.pin.side !== 'middle')
      add(item.pin.host, { key: item.key, side: item.pin.side });
  }
  for (const item of items) {
    const last = item.span?.at(-1);
    if (last !== undefined) add(last, { key: item.key, side: 'bottom' });
  }
  return result;
}

/** The host block with its side blocks around it, moved to the origin. */
function around(host: Block, sides: SideBlocks, gap: number): Block {
  const { width: w, height: h } = host;
  const top = row(sides.top, gap);
  const bottom = column(sides.bottom, gap);
  const left = column(sides.left, gap);
  const right = column(sides.right, gap);
  const parts = [host];
  if (top.width > 0) parts.push(shift(top, (w - top.width) / 2, -gap - top.height));
  if (bottom.width > 0) parts.push(shift(bottom, (w - bottom.width) / 2, h + gap));
  if (left.width > 0) parts.push(shift(left, -gap - left.width, (h - left.height) / 2));
  if (right.width > 0) parts.push(shift(right, w + gap, (h - right.height) / 2));
  return combine(parts);
}
