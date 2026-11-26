import type { Point } from '../primitives/geometry.ts';
import type { Size } from '../primitives/types.ts';
import type { Rect, Zone } from '../theme/index.ts';
import type { Block, Guide } from './blocks.ts';

export type { Block, Guide } from './blocks.ts';

/**
 * Layout engine types. Layout is pure and React-free: it reads world items (registered primitives
 * with parsed props and size hints), the beat's layout mode and focus, and a frame, and returns
 * where every item goes. Components never see any of it except their own `box` and `path`.
 */

/** Where a board may go: the frame rect and the avoid zones inside it (hard constraints). */
export type LayoutFrame = { rect: Rect; avoidZones: readonly Zone[] };

/**
 * How the layout treats an item:
 * - `solid`: placed by the mode; never overlaps another solid.
 * - `background`: placed by the mode, others sit on it (a `map_base`).
 * - `framed`: shares another item's rect (overlays on a map, a grid `over` its target).
 * - `decoration`: drawn around another item (`radius_ring`); may overlap neighbours.
 * - `relational`: a path between items (`connector`, `packet_stream`).
 * - `pin`: follows a side of another item (or a connector's midpoint); never overlaps a solid.
 * - `overlay`: above the scrim, centred in the frame (`statement_card`, `inset_panel`).
 */
export const ITEM_ROLES = [
  'solid',
  'background',
  'framed',
  'decoration',
  'relational',
  'pin',
  'overlay',
] as const;
export type ItemRole = (typeof ITEM_ROLES)[number];

export type PlacedItem = {
  key: string;
  role: ItemRole;
  /** Canvas px (before the beat camera). */
  rect: Rect;
  /** Canvas px per box px: the component draws in `rect / scale` and is scaled by this. */
  scale: number;
  z: number;
  /** For relational items: the path in the item's own box px (layout output, never authored). */
  path?: readonly Point[];
  /** Contained items (an `inset_panel`'s children), with rects in the container's box px. */
  children?: readonly PlacedItem[];
};

/** The component's own box: the placed rect in its own px. */
export function boxOf(item: Pick<PlacedItem, 'rect' | 'scale'>): Size {
  return { width: item.rect.width / item.scale, height: item.rect.height / item.scale };
}

export const LAYOUT_WARNING_CODES = [
  'too_many_elements',
  'text_too_small',
  'overlap',
  'unknown_zone',
  'unknown_layout_mode',
  'layout_mode_ignored',
  'pin_unresolved',
  'connector_crosses',
  'text_covered',
  'avoid_zone',
  'key_element_too_small',
] as const;
export type LayoutWarningCode = (typeof LAYOUT_WARNING_CODES)[number];

/** A layout problem the Curator repairs; never stops a render. `keys` name the items involved. */
export type LayoutWarning = { code: LayoutWarningCode; message: string; keys: string[] };

/** One placement for a board (a beat, or a `continuesPrevious` chain of beats). */
export type BoardLayout = {
  mode: string;
  /** The frame the board was fitted into (the footnote line, when reserved, is below it). */
  frame: Rect;
  /** Board scale: canvas px per logical px (1 = every element at its preferred size). */
  scale: number;
  /** Board items, back to front. */
  items: readonly PlacedItem[];
  /** Overlays, back to front (drawn above the scrim). */
  overlays: readonly PlacedItem[];
  guides: readonly Guide[];
  warnings: readonly LayoutWarning[];
};

/** A unit the mode places: a solid or background item with everything pinned to its sides. */
export type Unit = {
  key: string;
  zone: string;
  /** Logical px at scale 1, focus boost and pinned items included. */
  size: Size;
  /** Position among the scene's items (spec order), for modes that order mixed items. */
  order: number;
};

/** A connector between two units (pins resolve to their host), for ranks and routing. */
export type Link = {
  key: string;
  from: string;
  to: string;
  zone: string | undefined;
  order: number;
};

export type ModeContext = {
  /** Units by zone, each list in spec order. */
  zones: ReadonlyMap<string, readonly Unit[]>;
  links: readonly Link[];
  focus: ReadonlySet<string>;
  /** Minimum space between units. */
  gap: number;
  /** Space between linked units: room for connector labels and midpoint pins. */
  linkGap: number;
  /** Frame width / height: below 1 the frame is tall (full format), above it wide (card). */
  aspect: number;
  /** Widest row (logical px) that still fits the frame at the readable minimum scale. */
  maxRowWidth: number;
  /** Logical size of the label band above and below a routed message line. */
  labelBand: number;
  /** Sides of each unit's own element that hold pins (links should not run through them). */
  pinnedSides: ReadonlyMap<string, ReadonlySet<string>>;
};

/** A layout mode's placement: units in logical px, composed into one block. */
export type ModePlacer = (ctx: ModeContext) => Block;
