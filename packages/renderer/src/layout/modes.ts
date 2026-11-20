import {
  LAYOUT_MODE_CATALOGUE,
  LAYOUT_MODE_IDS,
  type BeatScene,
  type LayoutModeEntry,
  type LayoutModeId,
} from '@explainer-studio/shared';
import { placeNearFar, placePipeline } from './place/flow.ts';
import { placeGrid, placeStackedList, placeTwoColumn, placeVersusSplit } from './place/lists.ts';
import { placeMap } from './place/map.ts';
import { placeCenteredFocus, placeCycle, placeHubSpoke } from './place/radial.ts';
import { placeSwimlane } from './place/swimlane.ts';
import type { ModePlacer } from './types.ts';

/**
 * Layout modes: the data (ids, zones, capacity, LLM-facing text) is the shared
 * `LAYOUT_MODE_CATALOGUE` (P1C.4); this file adds how each mode places its elements. Adding a
 * mode means adding a catalogue entry and its behaviour here (typecheck fails without one);
 * nothing else switches on ids. React-free.
 */

export { LAYOUT_MODE_IDS, type LayoutModeId };

type LayoutModeBehaviour = {
  place: ModePlacer;
  /** Zone for an element that names none (or an unknown one); default: the first zone. */
  defaultZone?: (primitive: string | undefined) => string;
  /** Elements in `zone` share the rect of the first element in `base` (overlays on a map). */
  frameZone?: { zone: string; base: string };
};

export type LayoutModeDefinition = LayoutModeEntry & LayoutModeBehaviour;

/** Map zones for elements that name none: the base, and what lies over it. */
const MAP_DEFAULT_ZONES: Readonly<Record<string, string>> = {
  map_base: 'base',
  grid_overlay: 'overlay',
  route_path: 'overlay',
  zone_polygon: 'overlay',
};

/** A beat without a layout mode of its own and without patterns uses this one. */
export const DEFAULT_LAYOUT_MODE: LayoutModeId = 'centered_focus';

const BEHAVIOURS: Readonly<Record<LayoutModeId, LayoutModeBehaviour>> = {
  map: {
    place: placeMap,
    defaultZone: (primitive) => MAP_DEFAULT_ZONES[primitive ?? ''] ?? 'marker',
    frameZone: { zone: 'overlay', base: 'base' },
  },
  two_column: { place: placeTwoColumn },
  grid: { place: placeGrid },
  stacked_list: { place: placeStackedList },
  centered_focus: { place: placeCenteredFocus },
  pipeline: { place: placePipeline },
  cycle: { place: placeCycle },
  swimlane: { place: placeSwimlane },
  versus_split: { place: placeVersusSplit },
  near_far: { place: placeNearFar },
  hub_spoke: { place: placeHubSpoke },
};

export const LAYOUT_MODE_DEFINITIONS: readonly LayoutModeDefinition[] =
  LAYOUT_MODE_CATALOGUE.entries.map((entry) => ({ ...entry, ...BEHAVIOURS[entry.id] }));

export const LAYOUT_MODES: ReadonlyMap<string, LayoutModeDefinition> = new Map(
  LAYOUT_MODE_DEFINITIONS.map((mode) => [mode.id, mode]),
);

/** Patterns as far as layout cares: the mode each pattern id declares. */
export type PatternLayouts = ReadonlyMap<string, { layoutMode: LayoutModeId }>;

/**
 * The beat's layout mode: its own `layoutMode` when set (an explicit choice always wins), else
 * the mode of its first registered pattern, else `DEFAULT_LAYOUT_MODE`.
 */
export function beatLayoutMode(scene: BeatScene, patterns: PatternLayouts): string {
  if (scene.layoutMode !== undefined) return scene.layoutMode;
  return patternLayoutModes(scene, patterns)[0] ?? DEFAULT_LAYOUT_MODE;
}

/** Distinct layout modes the beat's registered patterns declare, in pattern order. */
export function patternLayoutModes(scene: BeatScene, patterns: PatternLayouts): LayoutModeId[] {
  const modes = scene.patterns.flatMap((p) => {
    const mode = patterns.get(p.pattern)?.layoutMode;
    return mode ? [mode] : [];
  });
  return [...new Set(modes)];
}
