import { INSTANCE_PIN_MESSAGE } from '../catalog/pin-hosts.ts';
import type { ElementRef, PinSide, Size } from '../primitives/types.ts';
import type { WorldItem } from '../scene/beat-world.ts';
import { MARKER_SIZE } from '../scene/marker.ts';
import type { Theme } from '../theme/index.ts';
import { clusterBlocks, type Cluster } from './cluster.ts';
import { containerSize } from './containers.ts';
import type { LayoutModeDefinition } from './modes.ts';
import type { ItemRole, LayoutWarning, Link, Unit } from './types.ts';

/**
 * Turns a board's world items into what the layout modes place: units (solid and background
 * elements with everything pinned to their sides, as one cluster), links (connectors between
 * units) and each item's role. Refs that cannot be honoured (a pin to a missing element, a pin
 * cycle) are dropped with a warning and the item is placed as an ordinary element. Pure.
 */

/** A focus element is drawn this much larger than the rest, so it is always the largest. */
export const FOCUS_BOOST = 1.2;

/** Zones whose elements are the middle of their mode; drawn like a focus element. */
export const CENTRAL_ZONES: readonly string[] = ['center', 'hub'];

export type SceneItem = {
  key: string;
  item: WorldItem;
  /** Position in the input (spec order). */
  order: number;
  role: ItemRole;
  /** Zone in the mode (resolved: unknown or missing zones take the mode's default). */
  zone: string;
  /** Preferred size in logical px (before any boost); a container's comes from its children. */
  size: Size;
  /** Scale on top of the board scale (focus elements are larger). */
  boost: number;
  /** Element refs (ids are item keys, namespaced like them). */
  refs: readonly ElementRef[];
  /** A pinned item: what it follows and on which side. */
  pin?: { host: string; side: PinSide };
  /** A `span` item (a bracket): the items it spans. */
  span?: readonly string[];
  /** A `ring` or `frame` item: the item it surrounds or shares a rect with. */
  target?: string;
  /** A ring's other refs: items it must enclose (with their side pins). */
  encloses?: readonly string[];
};

export type Analysis = {
  items: readonly SceneItem[];
  units: readonly Unit[];
  links: readonly Link[];
  /** Each unit's cluster: the unit's item and its pins, positioned inside the unit's rect. */
  clusters: ReadonlyMap<string, Cluster>;
  warnings: readonly LayoutWarning[];
};

const UNIT_ROLES: readonly ItemRole[] = ['solid', 'background'];

export function analyse(
  worldItems: readonly WorldItem[],
  mode: LayoutModeDefinition,
  focus: ReadonlySet<string>,
  theme: Theme,
): Analysis {
  const warnings: LayoutWarning[] = [];
  const base = worldItems.map((item, order) => baseItem(item, order, mode, theme, warnings));
  const items = resolveRefs(base, warnings).map((i) => withBoost(i, focus));
  const clusters = clusterBlocks(items, theme.space.xs);
  const units = items
    .filter((i) => UNIT_ROLES.includes(i.role))
    .map((i): Unit => {
      const block = clusters.get(i.key)?.block;
      return {
        key: i.key,
        zone: i.zone,
        size: block ? { width: block.width, height: block.height } : scaled(i.size, i.boost),
        order: i.order,
      };
    });
  return { items, units, links: linksOf(items), clusters, warnings };
}

function baseItem(
  item: WorldItem,
  order: number,
  mode: LayoutModeDefinition,
  theme: Theme,
  warnings: LayoutWarning[],
): SceneItem {
  const zone = resolveZone(item, mode, warnings);
  return {
    key: item.key,
    item,
    order,
    role: baseRole(item, mode, zone),
    zone,
    size: sizeOf(item, theme),
    boost: 1,
    refs: refsOf(item),
  };
}

function withBoost(item: SceneItem, focus: ReadonlySet<string>): SceneItem {
  const central = CENTRAL_ZONES.includes(item.zone);
  const boosted = item.role === 'solid' && (focus.has(item.key) || central);
  return boosted ? { ...item, boost: FOCUS_BOOST } : item;
}

export function sizeOf(item: WorldItem, theme: Theme): Size {
  if (item.kind === 'error') return MARKER_SIZE;
  if (item.definition.contentInset && item.children.length > 0) {
    return containerSize(item, theme);
  }
  const hints = item.definition.sizeHints(item.props, theme);
  return { width: hints.preferredWidth, height: hints.preferredHeight };
}

export const scaled = (size: Size, k: number): Size => ({
  width: size.width * k,
  height: size.height * k,
});

function refsOf(item: WorldItem): ElementRef[] {
  if (item.kind !== 'primitive' || !item.definition.elementRefs) return [];
  return item.definition.elementRefs(item.props);
}

function resolveZone(item: WorldItem, mode: LayoutModeDefinition, warnings: LayoutWarning[]) {
  const asked = item.kind === 'primitive' ? item.zone : undefined;
  if (asked !== undefined && mode.zones.includes(asked)) return asked;
  if (asked !== undefined) {
    warnings.push({
      code: 'unknown_zone',
      message: `"${item.key}" asks for zone "${asked}", which ${mode.id} does not have (zones: ${mode.zones.join(', ')}).`,
      keys: [item.key],
    });
  }
  const primitive = item.kind === 'primitive' ? item.definition.id : undefined;
  return mode.defaultZone?.(primitive) ?? mode.zones[0] ?? 'aside';
}

/** The role from the primitive and the mode alone, before refs are checked. */
function baseRole(item: WorldItem, mode: LayoutModeDefinition, zone: string): ItemRole {
  if (item.kind === 'error') return 'solid';
  if (item.layer === 'overlay') return 'overlay';
  if (item.definition.layoutRole === 'path') return 'relational';
  if (item.definition.layoutRole === 'background') return 'background';
  return mode.frameZone?.zone === zone ? 'framed' : 'solid';
}

/**
 * Checks each item's refs against the board and settles its role: relational items need their
 * ends, frames, rings and spans their targets, pins a host that is on the board and not pinned
 * back to them. Anything unresolved stays as it was placed by its zone (an ordinary element, or
 * an overlay on the map).
 */
function resolveRefs(items: readonly SceneItem[], warnings: LayoutWarning[]): SceneItem[] {
  const board = new Set(items.filter((i) => i.role !== 'overlay').map((i) => i.key));
  const settled = items.map((i): SceneItem => {
    if (i.role === 'overlay') return i;
    const pinRef = i.refs.find((r) => r.pin !== undefined);
    if (pinRef?.pin) return { ...i, role: 'pin', pin: { host: pinRef.id, side: pinRef.pin } };
    const layoutRole = i.item.kind === 'primitive' ? i.item.definition.layoutRole : undefined;
    if (layoutRole === undefined || layoutRole === 'background') return i;
    const ids = i.refs.map((r) => r.id);
    if (ids.length === 0 || !ids.every((id) => board.has(id))) {
      return i.role === 'relational' ? { ...i, role: 'solid' } : i;
    }
    switch (layoutRole) {
      case 'span':
        return { ...i, role: 'pin', span: ids };
      case 'ring':
        return { ...i, role: 'decoration', target: ids[0], encloses: ids.slice(1) };
      case 'frame':
        return { ...i, role: 'framed', target: ids[0] };
      default:
        return i;
    }
  });
  return dropBadPins(settled, warnings);
}

/** Pins whose host is missing, of the wrong kind, or part of a cycle become ordinary elements. */
function dropBadPins(items: SceneItem[], warnings: LayoutWarning[]): SceneItem[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  return items.map((i) => {
    const problem = pinProblem(i, byKey);
    if (!problem) return i;
    warnings.push({ code: 'pin_unresolved', message: `"${i.key}" ${problem}`, keys: [i.key] });
    return withoutPin(i);
  });
}

function withoutPin(item: SceneItem): SceneItem {
  const copy: SceneItem = { ...item, role: 'solid' };
  delete copy.pin;
  return copy;
}

function pinProblem(item: SceneItem, byKey: ReadonlyMap<string, SceneItem>): string | undefined {
  const pin = item.pin;
  if (!pin) return undefined;
  const host = byKey.get(pin.host);
  const instance = !host && [...byKey.keys()].some((key) => key.startsWith(`${pin.host}/`));
  if (instance || pin.host.includes('/')) {
    return `is pinned to "${pin.host}": ${INSTANCE_PIN_MESSAGE}; pin it to one of this board's own elements. Placed on its own.`;
  }
  if (!host || host.role === 'overlay') {
    return `is pinned to "${pin.host}", which is not on this board; placed on its own.`;
  }
  if (pin.side === 'middle' && host.role !== 'relational') {
    return `is pinned to the middle of "${pin.host}", which is not a drawn connector; placed on its own.`;
  }
  if (pin.side !== 'middle' && host.role === 'relational') {
    return `is pinned to a side of connector "${pin.host}"; pin it to the middle instead. Placed on its own.`;
  }
  return pinCycle(item, byKey) ? 'is part of a pin cycle; placed on its own.' : undefined;
}

function pinCycle(item: SceneItem, byKey: ReadonlyMap<string, SceneItem>): boolean {
  const seen = new Set<string>();
  for (let at: SceneItem | undefined = item; at?.pin; at = byKey.get(at.pin.host)) {
    if (seen.has(at.key)) return at.key === item.key;
    seen.add(at.key);
  }
  return false;
}

/** Connectors whose two ends are on the board, between the units holding them, in spec order. */
function linksOf(items: readonly SceneItem[]): Link[] {
  const unitOf = unitResolver(items);
  return items.flatMap((i) => {
    const [from, to] = i.refs.map((r) => unitOf(r.id));
    if (i.role !== 'relational' || from === undefined || to === undefined) return [];
    return [{ key: i.key, from, to, zone: i.zone, order: i.order }];
  });
}

/** The unit an item belongs to: itself, or the unit at the root of its pin chain. */
export function unitResolver(items: readonly SceneItem[]): (key: string) => string | undefined {
  const byKey = new Map(items.map((i) => [i.key, i]));
  return (key) => {
    let at = byKey.get(key);
    for (let hops = 0; at && hops <= items.length; hops += 1) {
      if (UNIT_ROLES.includes(at.role)) return at.key;
      at = at.pin && at.pin.side !== 'middle' ? byKey.get(at.pin.host) : undefined;
    }
    return undefined;
  };
}
