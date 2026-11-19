import { pointAlong, type Point } from '../primitives/geometry.ts';
import type { Size } from '../primitives/types.ts';
import type { Rect } from '../theme/index.ts';
import type { SceneItem } from './analyse.ts';
import { bottom, centre, inflate, overlaps, pointsRect, union } from './rect.ts';
import { routeConnector, type RouteParams } from './routing.ts';

/**
 * Everything that follows another item, placed once the mode has placed the units: frames share
 * their target's rect, rings surround theirs, connectors run between their ends' edges (or along a
 * route the mode drew), packet streams along their connector, midpoint pins sit on their
 * connector's middle, pins on items outside any cluster sit on their host's side, and spans run
 * under their targets. Items that depend on each other are placed in passes. Pure; mutates the
 * maps it is given.
 */

export type RelationParams = RouteParams & {
  /** Space between a pin (or span) and its host. */
  pinGap: number;
  /** Room above and below a connector's line for its label. */
  labelBand: number;
  /** Space between a ring and the element inside it. */
  ringPad: number;
};

/** Where a connector's midpoint pins go (the middle of its route's midpoint segment). */
type Anchors = Map<string, { point: Point; angle: number }>;

/** What one placement pass reads and writes. */
type Pass = {
  rects: Map<string, Rect>;
  paths: Map<string, readonly Point[]>;
  anchors: Anchors;
  /** Rects of pins placed in an earlier pass, so routes avoid them before they are placed. */
  earlier: ReadonlyMap<string, Rect>;
  params: RelationParams;
  items: readonly SceneItem[];
};

/**
 * Places every follower. Runs twice: the first pass routes connectors around the elements and the
 * pins already in their clusters; the second routes again with every pin from the first pass
 * (midpoint pins included) as an obstacle, then places the pins on the final routes.
 */
export function placeFollowers(
  items: readonly SceneItem[],
  rects: Map<string, Rect>,
  paths: Map<string, readonly Point[]>,
  params: RelationParams,
): void {
  const baseRects = new Map(rects);
  const basePaths = new Map(paths);
  const first = runPass({ rects, paths, anchors: new Map(), earlier: new Map(), params, items });
  const pins = new Map(
    items
      .filter((i) => i.role === 'pin')
      .flatMap((i) => {
        const r = first.rects.get(i.key);
        return r ? [[i.key, r] as const] : [];
      }),
  );
  rects.clear();
  baseRects.forEach((r, k) => rects.set(k, r));
  paths.clear();
  basePaths.forEach((p, k) => paths.set(k, p));
  runPass({ rects, paths, anchors: new Map(), earlier: pins, params, items });
}

function runPass(pass: Pass): Pass {
  // Connectors route in key order, so the result never depends on spec order quirks.
  const pending = pass.items
    .filter(isFollower)
    .sort(
      (a, b) =>
        Number(b.role === 'relational') - Number(a.role === 'relational') || compare(a.key, b.key),
    );
  for (let round = 0; round <= pass.items.length && pending.length > 0; round += 1) {
    for (let i = 0; i < pending.length;) {
      const item = pending[i];
      if (item && placeOne(item, pass)) pending.splice(i, 1);
      else i += 1;
    }
  }
  return pass;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function isFollower(item: SceneItem): boolean {
  if (item.role === 'relational' || item.target !== undefined || item.span) return true;
  return item.pin !== undefined;
}

/** Places one follower if what it depends on is placed; true when done. */
function placeOne(item: SceneItem, pass: Pass): boolean {
  const { rects, paths, params } = pass;
  if (item.role === 'relational') return placePath(item, pass);
  if (item.span) return placeSpan(item, rects, params);
  if (item.target !== undefined) {
    const target = rects.get(item.target);
    if (!target) return false;
    rects.set(item.key, item.role === 'decoration' ? ringRect(item, target, params) : target);
    return true;
  }
  if (item.pin) {
    if (rects.has(item.key) && item.pin.side !== 'middle') return true;
    return placePin(item, rects, paths, pass.anchors, params, pinObstacles(item, pass));
  }
  return true;
}

function sizeOf(item: SceneItem): Size {
  return { width: item.size.width * item.boost, height: item.size.height * item.boost };
}

/**
 * A connector between its ends, routed around what is in the way (or along the mode's route); a
 * stream along its connector's path.
 */
function placePath(item: SceneItem, pass: Pass): boolean {
  const { rects, paths, anchors, params } = pass;
  const [first, second] = item.refs;
  let path = paths.get(item.key);
  if (!path && first && !second) path = paths.get(first.id);
  if (!path && first && second) {
    const from = rects.get(first.id);
    const to = rects.get(second.id);
    if (!from || !to) return false;
    const route = routeConnector(from, to, obstaclesFor(item, pass), params);
    path = route.path;
    anchors.set(item.key, route.anchor);
  }
  if (!path) return false;
  paths.set(item.key, path);
  const bounds = pointsRect(path);
  if (bounds) rects.set(item.key, inflate(bounds, params.labelBand));
  return true;
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

/**
 * What a connector must not cross: every element and pin on the board (placed, or placed in an
 * earlier pass) except its own ends and the pins on itself. Backgrounds, frames, rings and other
 * connectors may be crossed.
 */
function obstaclesFor(item: SceneItem, pass: Pass): Rect[] {
  const ends = new Set(item.refs.map((r) => r.id));
  return pass.items.flatMap((other) => {
    if (other.role !== 'solid' && other.role !== 'pin') return [];
    if (ends.has(other.key) || other.key === item.key || other.pin?.host === item.key) return [];
    const r = pass.rects.get(other.key) ?? pass.earlier.get(other.key);
    return r ? [r] : [];
  });
}

/** The elements and other pins a pin must not cover (placed so far). */
function pinObstacles(item: SceneItem, pass: Pass): Rect[] {
  return pass.items.flatMap((other) => {
    if (other.key === item.key || (other.role !== 'solid' && other.role !== 'pin')) return [];
    const r = pass.rects.get(other.key);
    return r ? [r] : [];
  });
}

function placePin(
  item: SceneItem,
  rects: Map<string, Rect>,
  paths: Map<string, readonly Point[]>,
  anchors: Anchors,
  params: RelationParams,
  blocked: readonly Rect[],
): boolean {
  const pin = item.pin;
  if (!pin) return true;
  const size = sizeOf(item);
  if (pin.side === 'middle') {
    const path = paths.get(pin.host);
    if (!path) return false;
    const at = anchors.get(pin.host) ?? pointAlong(path, 0.5);
    rects.set(item.key, besideLine(at, size, params.pinGap, blocked));
    return true;
  }
  const host = rects.get(pin.host);
  if (!host) return false;
  rects.set(item.key, besideRect(host, size, pin.side, params.pinGap));
  return true;
}

/**
 * A midpoint pin beside its connector, so the line never runs through it: below a mostly
 * horizontal line (its label is above), right of a mostly vertical one, `gap` away. When that
 * side would cover an element (a route hugging a column), the other side.
 */
export function besideLine(
  at: { point: Point; angle: number },
  size: Size,
  gap: number,
  blocked: readonly Rect[] = [],
): Rect {
  const { point } = at;
  const horizontal = Math.abs(Math.cos(at.angle)) >= Math.abs(Math.sin(at.angle));
  const sides: Rect[] = horizontal
    ? [
        { x: point.x - size.width / 2, y: point.y + gap, ...size },
        { x: point.x - size.width / 2, y: point.y - gap - size.height, ...size },
      ]
    : [
        { x: point.x + gap, y: point.y - size.height / 2, ...size },
        { x: point.x - gap - size.width, y: point.y - size.height / 2, ...size },
      ];
  const [preferred, other] = sides as [Rect, Rect];
  const free = (r: Rect) => !blocked.some((b) => overlaps(r, b));
  return free(preferred) || !free(other) ? preferred : other;
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
