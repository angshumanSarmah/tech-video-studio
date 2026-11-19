import type { Point } from '../primitives/geometry.ts';
import type { WorldItem } from '../scene/beat-world.ts';
import type { Rect, Theme, Zone } from '../theme/index.ts';
import { analyse, type Analysis, type SceneItem } from './analyse.ts';
import { arrange, type Arranged } from './arrange.ts';
import { containerChildren } from './containers.ts';
import {
  applyPoint,
  applyRect,
  avoidConflicts,
  boundsOf,
  clearFrames,
  fitTransform,
  slides,
  type Shapes,
  type Transform,
} from './fit.ts';
import { DEFAULT_LAYOUT_MODE, LAYOUT_MODES, type LayoutModeDefinition } from './modes.ts';
import { minReadableScale } from './readable.ts';
import { inside } from './rect.ts';
import type { BoardLayout, ItemRole, LayoutFrame, LayoutWarning, PlacedItem } from './types.ts';
import { boardWarnings } from './warnings.ts';

/**
 * The layout engine: where every element of a board goes. Pure, React-free and deterministic (no
 * randomness; items keep their input order wherever the mode has no reason to reorder them).
 *
 *   world items + mode + focus ──analyse──▶ units and links
 *     ──arrange (mode placer, separation)──▶ logical rects (scale 1)
 *     ──fit──▶ canvas rects in the frame, clear of the avoid zones
 *
 * Elements are drawn at one board scale (at most 1: never above their preferred size); focus
 * elements and the middle of radial modes are `FOCUS_BOOST` larger. Fitting into the frame always
 * wins over readability: a board that only fits below the readable scale gets `text_too_small`.
 */

export type LayoutInput = {
  items: readonly WorldItem[];
  /** Layout mode id; an unknown id falls back to the default with a warning. */
  mode: string;
  /** Element keys to draw largest (and in the middle where the mode has one). */
  focus: readonly string[];
};

/** Stacking order by role, back to front. */
const Z_BY_ROLE: Record<ItemRole, number> = {
  background: 0,
  framed: 1,
  decoration: 2,
  relational: 3,
  solid: 4,
  pin: 5,
  overlay: 10,
};

export function layout(input: LayoutInput, theme: Theme, frame: LayoutFrame): BoardLayout {
  const known = LAYOUT_MODES.get(input.mode);
  const mode = known ?? defaultMode();
  const focus = new Set(input.focus);
  const analysis = analyse(input.items, mode, focus, theme);
  const placed = placeBoard(analysis, mode, focus, theme, frame);
  const items = boardItems(analysis, placed.arranged, placed.transform);
  const overlays = overlayItems(analysis, theme, frame);
  const warnings: LayoutWarning[] = [
    ...(known ? [] : [unknownMode(input.mode)]),
    ...analysis.warnings,
    ...(placed.clear ? [] : [avoidWarning(placed.conflicts)]),
    ...boardWarnings({ analysis, mode, items, scale: placed.transform.scale, theme }),
  ];
  return {
    mode: mode.id,
    frame: frame.rect,
    scale: placed.transform.scale,
    items,
    overlays,
    guides: placed.arranged.guides.map((g) => ({
      from: applyPoint(placed.transform, g.from),
      to: applyPoint(placed.transform, g.to),
    })),
    warnings,
  };
}

type Placement = {
  arranged: Arranged;
  transform: Transform;
  clear: boolean;
  conflicts: string[];
};

/**
 * Arranges and fits the board in the frame; when that overlaps an avoid zone, slides it clear, or
 * re-arranges it for the part of the frame beside or above the zones (largest scale wins).
 */
function placeBoard(
  analysis: Analysis,
  mode: LayoutModeDefinition,
  focus: ReadonlySet<string>,
  theme: Theme,
  frame: LayoutFrame,
): Placement {
  const minScale = minReadableScale(theme);
  const attempt = (rect: Rect) => {
    const arranged = arrange(analysis, mode, {
      theme,
      focus,
      aspect: rect.width / Math.max(1, rect.height),
      maxRowWidth: rect.width / minScale,
    });
    return { rect, arranged, transform: fitTransform(boundsOf(arranged), rect) };
  };
  return chooseClear(attempt, frame, theme.space.md);
}

type Attempt = { rect: Rect; arranged: Arranged; transform: Transform };

/** The first attempt that clears the zones (as fitted or slid), else the best re-fit. */
export function chooseClear(
  attempt: (rect: Rect) => Attempt,
  frame: LayoutFrame,
  gap: number,
): Placement {
  const first = attempt(frame.rect);
  const cleared = clearTransform(first, frame.avoidZones);
  if (cleared) return { arranged: first.arranged, transform: cleared, clear: true, conflicts: [] };
  const alternatives = clearFrames(frame.rect, frame.avoidZones, gap)
    .map(attempt)
    .flatMap((a) => {
      const t = clearTransform(a, frame.avoidZones);
      return t ? [{ arranged: a.arranged, transform: t }] : [];
    })
    .sort((a, b) => b.transform.scale - a.transform.scale);
  const best = alternatives[0];
  if (best) return { ...best, clear: true, conflicts: [] };
  const conflicts = avoidConflicts(shapesOf(first.arranged, first.transform), frame.avoidZones);
  return { arranged: first.arranged, transform: first.transform, clear: false, conflicts };
}

/** The attempt's transform if it clears the zones, else a slide that does and stays in its rect. */
function clearTransform(a: Attempt, zones: readonly Zone[]): Transform | undefined {
  const shapes = shapesOf(a.arranged, a.transform);
  const conflicts = avoidConflicts(shapes, zones);
  if (conflicts.length === 0) return a.transform;
  const bounds = boundsOf(a.arranged);
  for (const move of slides(shapes, zones, conflicts)) {
    const t = { ...a.transform, dx: a.transform.dx + move.x, dy: a.transform.dy + move.y };
    if (bounds && !inside(a.rect, applyRect(t, bounds))) continue;
    if (avoidConflicts(shapesOf(a.arranged, t), zones).length === 0) return t;
  }
  return undefined;
}

export function shapesOf(arranged: Arranged, t: Transform): Shapes {
  const rects = new Map<string, Rect>();
  arranged.rects.forEach((r, k) => rects.set(k, applyRect(t, r)));
  const paths = new Map<string, readonly Point[]>();
  arranged.paths.forEach((pts, k) =>
    paths.set(
      k,
      pts.map((p) => applyPoint(t, p)),
    ),
  );
  arranged.guides.forEach((g, i) =>
    paths.set(`guide-${i}`, [applyPoint(t, g.from), applyPoint(t, g.to)]),
  );
  return { rects, paths };
}

/** Every board item with a rect, in canvas px, back to front (stable within a role). */
function boardItems(analysis: Analysis, arranged: Arranged, t: Transform): PlacedItem[] {
  return analysis.items
    .flatMap((item) => {
      const rect = arranged.rects.get(item.key);
      if (!rect || item.role === 'overlay') return [];
      const placed = placedItem(item, applyRect(t, rect), t.scale * item.boost);
      const path = arranged.paths.get(item.key);
      if (!path) return [placed];
      // Box px equal logical px for relational items (they are never boosted).
      return [{ ...placed, path: path.map((p) => ({ x: p.x - rect.x, y: p.y - rect.y })) }];
    })
    .sort((a, b) => a.z - b.z);
}

function placedItem(item: SceneItem, rect: Rect, scale: number): PlacedItem {
  return { key: item.key, role: item.role, rect, scale, z: Z_BY_ROLE[item.role] };
}

/**
 * Overlays at their preferred size (smaller if needed), centred in the frame, clear of zones. A
 * container's size comes from its children, which it lays out in its own frame.
 */
function overlayItems(analysis: Analysis, theme: Theme, frame: LayoutFrame): PlacedItem[] {
  return analysis.items
    .filter((item) => item.role === 'overlay')
    .map((item, i) => {
      const own = { x: 0, y: 0, ...item.size };
      const attempt = (rect: Rect): Attempt => ({
        rect,
        arranged: { rects: new Map([[item.key, own]]), paths: new Map(), guides: [] },
        transform: fitTransform(own, rect),
      });
      const { transform } = chooseClear(attempt, frame, theme.space.md);
      const children = containerChildren(item.item, theme, item.size);
      return {
        ...placedItem(item, applyRect(transform, own), transform.scale),
        z: Z_BY_ROLE.overlay + i,
        ...(children.length > 0 ? { children } : {}),
      };
    });
}

function unknownMode(id: string): LayoutWarning {
  const known = [...LAYOUT_MODES.keys()].join(', ');
  return {
    code: 'unknown_layout_mode',
    message: `Unknown layout mode "${id}"; laid out as ${DEFAULT_LAYOUT_MODE}. Modes: ${known}.`,
    keys: [],
  };
}

function avoidWarning(keys: string[]): LayoutWarning {
  return {
    code: 'avoid_zone',
    message: `Could not keep ${keys.join(', ')} out of the platform buttons' zone.`,
    keys,
  };
}

function defaultMode(): LayoutModeDefinition {
  const mode = LAYOUT_MODES.get(DEFAULT_LAYOUT_MODE);
  if (!mode) throw new Error(`Default layout mode ${DEFAULT_LAYOUT_MODE} is not registered.`);
  return mode;
}
