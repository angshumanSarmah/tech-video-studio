import type { Size } from '../primitives/types.ts';
import type { WorldItem } from '../scene/beat-world.ts';
import { MARKER_SIZE } from '../scene/marker.ts';
import type { Theme } from '../theme/index.ts';
import type { LayoutModeDefinition } from './modes.ts';
import type { ItemRole, LayoutWarning, Link, Unit } from './types.ts';

/**
 * Turns a board's world items into what the layout modes place: units (solid and background
 * elements, with their zone and size) and links (connectors between units), plus each item's role.
 * Pure.
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
  /** Preferred size in logical px (before any boost). */
  size: Size;
  /** Scale on top of the board scale (focus elements are larger). */
  boost: number;
  /** Element refs, as keys (namespaced like the item keys). */
  refs: readonly string[];
};

export type Analysis = {
  items: readonly SceneItem[];
  units: readonly Unit[];
  links: readonly Link[];
  warnings: readonly LayoutWarning[];
};

export function analyse(
  worldItems: readonly WorldItem[],
  mode: LayoutModeDefinition,
  focus: ReadonlySet<string>,
  theme: Theme,
): Analysis {
  const warnings: LayoutWarning[] = [];
  const items = worldItems.map((item, order) => {
    const zone = resolveZone(item, mode, warnings);
    const role = roleOf(item, mode, zone);
    const central = CENTRAL_ZONES.includes(zone);
    const boost = role === 'solid' && (focus.has(item.key) || central) ? FOCUS_BOOST : 1;
    return {
      key: item.key,
      item,
      order,
      role,
      zone,
      size: sizeOf(item, theme),
      boost,
      refs: refsOf(item),
    };
  });
  const units = items
    .filter((i) => i.role === 'solid' || i.role === 'background')
    .map((i): Unit => ({
      key: i.key,
      zone: i.zone,
      size: scaled(i.size, i.boost),
      order: i.order,
    }));
  return { items, units, links: linksOf(items), warnings };
}

export function sizeOf(item: WorldItem, theme: Theme): Size {
  if (item.kind === 'error') return MARKER_SIZE;
  const hints = item.definition.sizeHints(item.props, theme);
  return { width: hints.preferredWidth, height: hints.preferredHeight };
}

export const scaled = (size: Size, k: number): Size => ({
  width: size.width * k,
  height: size.height * k,
});

function refsOf(item: WorldItem): string[] {
  if (item.kind !== 'primitive' || !item.definition.elementRefs) return [];
  return item.definition.elementRefs(item.props).map((ref) => ref.id);
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

function roleOf(item: WorldItem, mode: LayoutModeDefinition, zone: string): ItemRole {
  if (item.kind === 'error') return 'solid';
  if (item.layer === 'overlay') return 'overlay';
  if (mode.frameZone?.zone === zone) return 'framed';
  switch (item.definition.layoutRole) {
    case 'background':
      return 'background';
    case 'path':
      return 'relational';
    default:
      return 'solid';
  }
}

/** Connectors whose two ends are units (directly), in spec order. */
function linksOf(items: readonly SceneItem[]): Link[] {
  const unitKeys = new Set(
    items.filter((i) => i.role === 'solid' || i.role === 'background').map((i) => i.key),
  );
  return items.flatMap((i) => {
    const [from, to] = i.refs;
    if (i.role !== 'relational' || from === undefined || to === undefined) return [];
    if (!unitKeys.has(from) || !unitKeys.has(to)) return [];
    return [{ key: i.key, from, to, zone: i.zone, order: i.order }];
  });
}
