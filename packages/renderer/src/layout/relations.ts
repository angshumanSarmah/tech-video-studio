import { distance, pointAlong, type Point } from '../primitives/geometry.ts';
import type { Size } from '../primitives/types.ts';
import type { Rect } from '../theme/index.ts';
import type { SceneItem } from './analyse.ts';
import { bottom, centre, exitPoint, inflate, pointsRect, union } from './rect.ts';

/**
 * Everything that follows another item, placed once the mode has placed the units: frames share
 * their target's rect, rings surround theirs, connectors run between their ends' edges (or along a
 * route the mode drew), packet streams along their connector, midpoint pins sit on their
 * connector's middle, pins on items outside any cluster sit on their host's side, and spans run
 * under their targets. Items that depend on each other are placed in passes. Pure; mutates the
 * maps it is given.
 */

export type RelationParams = {
  /** Space between a pin (or span) and its host. */
  pinGap: number;
  /** Space between a connector's end and the edge it leaves. */
  portGap: number;
  /** Room above and below a connector's line for its label. */
  labelBand: number;
  /** Space between a ring and the element inside it. */
  ringPad: number;
};

export function placeFollowers(
  items: readonly SceneItem[],
  rects: Map<string, Rect>,
  paths: Map<string, readonly Point[]>,
  params: RelationParams,
): void {
  const pending = items.filter(isFollower);
  for (let pass = 0; pass <= items.length && pending.length > 0; pass += 1) {
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const item = pending[i];
      if (item && placeOne(item, rects, paths, params)) pending.splice(i, 1);
    }
  }
}

function isFollower(item: SceneItem): boolean {
  if (item.role === 'relational' || item.target !== undefined || item.span) return true;
  return item.pin !== undefined;
}

/** Places one follower if what it depends on is placed; true when done. */
function placeOne(
  item: SceneItem,
  rects: Map<string, Rect>,
  paths: Map<string, readonly Point[]>,
  params: RelationParams,
): boolean {
  if (item.role === 'relational') return placePath(item, rects, paths, params);
  if (item.span) return placeSpan(item, rects, params);
  if (item.target !== undefined) {
    const target = rects.get(item.target);
    if (!target) return false;
    rects.set(item.key, item.role === 'decoration' ? ringRect(item, target, params) : target);
    return true;
  }
  if (item.pin) {
    if (rects.has(item.key) && item.pin.side !== 'middle') return true;
    return placePin(item, rects, paths, params);
  }
  return true;
}

function sizeOf(item: SceneItem): Size {
  return { width: item.size.width * item.boost, height: item.size.height * item.boost };
}

/** A connector between its ends (or along the mode's route); a stream along its connector. */
function placePath(
  item: SceneItem,
  rects: Map<string, Rect>,
  paths: Map<string, readonly Point[]>,
  params: RelationParams,
): boolean {
  const [first, second] = item.refs;
  let path = paths.get(item.key);
  if (!path && first && !second) path = paths.get(first.id);
  if (!path && first && second) {
    const from = rects.get(first.id);
    const to = rects.get(second.id);
    if (!from || !to) return false;
    path = straightPath(from, to, params.portGap);
  }
  if (!path) return false;
  paths.set(item.key, path);
  const bounds = pointsRect(path);
  if (bounds) rects.set(item.key, inflate(bounds, params.labelBand));
  return true;
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

/** A dashed circle around its target: wide enough to enclose it, label room kept on top. */
function ringRect(item: SceneItem, target: Rect, params: RelationParams): Rect {
  const own = sizeOf(item);
  const labelRoom = Math.max(0, own.height - own.width);
  const diameter = Math.max(
    own.width,
    Math.hypot(target.width, target.height) + 2 * params.ringPad,
  );
  const c = centre(target);
  const height = diameter + labelRoom;
  return { x: c.x - diameter / 2, y: c.y + diameter / 2 - height, width: diameter, height };
}

function placePin(
  item: SceneItem,
  rects: Map<string, Rect>,
  paths: Map<string, readonly Point[]>,
  params: RelationParams,
): boolean {
  const pin = item.pin;
  if (!pin) return true;
  const size = sizeOf(item);
  if (pin.side === 'middle') {
    const path = paths.get(pin.host);
    if (!path) return false;
    rects.set(item.key, besideLine(pointAlong(path, 0.5), size, params.pinGap));
    return true;
  }
  const host = rects.get(pin.host);
  if (!host) return false;
  rects.set(item.key, besideRect(host, size, pin.side, params.pinGap));
  return true;
}

/**
 * A midpoint pin beside its connector, so the line never runs through it: below a mostly
 * horizontal line (its label is above), right of a mostly vertical one, `gap` away.
 */
export function besideLine(at: { point: Point; angle: number }, size: Size, gap: number): Rect {
  const { point } = at;
  const horizontal = Math.abs(Math.cos(at.angle)) >= Math.abs(Math.sin(at.angle));
  return horizontal
    ? { x: point.x - size.width / 2, y: point.y + gap, ...size }
    : { x: point.x + gap, y: point.y - size.height / 2, ...size };
}

/** A rect of `size` centred on one side of `host`, `gap` away from it. */
export function besideRect(
  host: Rect,
  size: Size,
  side: 'top' | 'bottom' | 'left' | 'right',
  gap: number,
): Rect {
  const c = centre(host);
  switch (side) {
    case 'top':
      return { x: c.x - size.width / 2, y: host.y - gap - size.height, ...size };
    case 'bottom':
      return { x: c.x - size.width / 2, y: bottom(host) + gap, ...size };
    case 'left':
      return { x: host.x - gap - size.width, y: c.y - size.height / 2, ...size };
    case 'right':
      return { x: host.x + host.width + gap, y: c.y - size.height / 2, ...size };
  }
}

/** Under its targets, as wide as all of them (at least its own width), centred on them. */
function placeSpan(item: SceneItem, rects: Map<string, Rect>, params: RelationParams): boolean {
  const targets = (item.span ?? []).map((k) => rects.get(k));
  if (targets.some((r) => !r)) return false;
  const span = union(targets.filter((r): r is Rect => r !== undefined));
  if (!span) return true;
  const own = sizeOf(item);
  const width = Math.max(own.width, span.width);
  const reserved = rects.get(item.key);
  const y = Math.max(reserved?.y ?? -Infinity, bottom(span) + params.pinGap);
  rects.set(item.key, { x: span.x + (span.width - width) / 2, y, width, height: own.height });
  return true;
}
