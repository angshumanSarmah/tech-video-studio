import type { BeatScene } from '@explainer-studio/shared';
import { placeNearFar, placePipeline } from './place/flow.ts';
import { placeGrid, placeStackedList, placeTwoColumn, placeVersusSplit } from './place/lists.ts';
import { placeMap } from './place/map.ts';
import { placeCenteredFocus, placeCycle, placeHubSpoke } from './place/radial.ts';
import { placeSwimlane } from './place/swimlane.ts';
import type { ModePlacer } from './types.ts';

/**
 * Layout modes, each with the zones elements may be put in (`SceneElement.zone`), its placement
 * function and how many elements it holds before the scene gets a `too_many_elements` warning.
 * Adding a mode means adding a definition here (and its placer); nothing else switches on ids.
 * React-free.
 */

export const LAYOUT_MODE_IDS = [
  'map',
  'two_column',
  'grid',
  'stacked_list',
  'centered_focus',
  'pipeline',
  'cycle',
  'swimlane',
  'versus_split',
  'near_far',
  'hub_spoke',
] as const;
export type LayoutModeId = (typeof LAYOUT_MODE_IDS)[number];

export type LayoutModeDefinition = {
  id: LayoutModeId;
  /** Zone names elements may use, in reading order. `aside` holds labels next to the diagram. */
  zones: readonly string[];
  description: string;
  place: ModePlacer;
  /** Zone for an element that names none (or an unknown one); default: the first zone. */
  defaultZone?: (primitive: string | undefined) => string;
  /** Elements in `zone` share the rect of the first element in `base` (overlays on a map). */
  frameZone?: { zone: string; base: string };
  /** Most units (elements with their pins; asides not counted) the mode reads well with. */
  maxUnits: number;
};

/** Map zones for elements that name none: the base, and what lies over it. */
const MAP_DEFAULT_ZONES: Readonly<Record<string, string>> = {
  map_base: 'base',
  grid_overlay: 'overlay',
  route_path: 'overlay',
  zone_polygon: 'overlay',
};

/** A beat without a layout mode of its own and without patterns uses this one. */
export const DEFAULT_LAYOUT_MODE: LayoutModeId = 'centered_focus';

export const LAYOUT_MODE_DEFINITIONS: readonly LayoutModeDefinition[] = [
  {
    id: 'map',
    zones: ['base', 'overlay', 'marker', 'aside'],
    description: 'A map base filling the stage, overlays sharing its frame, markers on top.',
    place: placeMap,
    maxUnits: 6,
    defaultZone: (primitive) => MAP_DEFAULT_ZONES[primitive ?? ''] ?? 'marker',
    frameZone: { zone: 'overlay', base: 'base' },
  },
  {
    id: 'two_column',
    zones: ['left', 'right', 'aside'],
    description: 'Two columns of elements, read left then right.',
    place: placeTwoColumn,
    maxUnits: 8,
  },
  {
    id: 'grid',
    zones: ['cell', 'aside'],
    description: 'Equal elements in a grid of cells.',
    place: placeGrid,
    maxUnits: 12,
  },
  {
    id: 'stacked_list',
    zones: ['row', 'aside'],
    description: 'Elements stacked top to bottom as rows.',
    place: placeStackedList,
    maxUnits: 6,
  },
  {
    id: 'centered_focus',
    zones: ['center', 'around', 'aside'],
    description: 'One focus element in the middle, the rest smaller around it.',
    place: placeCenteredFocus,
    maxUnits: 7,
  },
  {
    id: 'pipeline',
    zones: ['source', 'stage', 'sink', 'aside'],
    description: 'Stages in flow order (top-down or left-right): sources, middle stages, sinks.',
    place: placePipeline,
    maxUnits: 10,
  },
  {
    id: 'cycle',
    zones: ['ring', 'center', 'aside'],
    description: 'Steps on a ring that loops back to the start, an optional element in the middle.',
    place: placeCycle,
    maxUnits: 8,
  },
  {
    id: 'swimlane',
    zones: ['lane-1', 'lane-2', 'lane-3', 'lane-4', 'message', 'aside'],
    description: 'Vertical lanes, one per actor, with ordered messages between them.',
    place: placeSwimlane,
    maxUnits: 12,
  },
  {
    id: 'versus_split',
    zones: ['left', 'right', 'shared'],
    description: 'Two halves side by side for the same situation; shared elements span both.',
    place: placeVersusSplit,
    maxUnits: 8,
  },
  {
    id: 'near_far',
    zones: ['origin', 'near', 'far', 'aside'],
    description: 'An origin with a near and a far destination, the distance drawn to scale.',
    place: placeNearFar,
    maxUnits: 5,
  },
  {
    id: 'hub_spoke',
    zones: ['hub', 'spoke', 'aside'],
    description: 'One hub in the middle with spokes around it.',
    place: placeHubSpoke,
    maxUnits: 9,
  },
];

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
