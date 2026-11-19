import { NO_FOCUS } from '../events/focus.ts';
import { expect } from 'vitest';
import { PRIMITIVES } from '../primitives/registry.ts';
import type { PrimitiveItem } from '../scene/scene-layers.ts';
import { getTheme, safeAreas, type Theme } from '../theme/index.ts';
import { inside, overlaps, pathCrossesRect, pointsRect } from './rect.ts';
import type { BoardLayout, LayoutFrame, PlacedItem } from './types.ts';
import { overlapWarnings } from './warnings.ts';

/** Test helpers: world items without a spec, standard frames, and the layout invariants. */

export const theme: Theme = getTheme('drafting-paper');

/** The full format's stage with its avoid zones (the platform buttons' notch). */
export function fullFrame(t: Theme = theme): LayoutFrame {
  const areas = safeAreas(t);
  return { rect: areas.stage, avoidZones: areas.avoidZones };
}

/** A wide 16:9 window clear of every zone (the card format's diagram window shape). */
export function wideFrame(t: Theme = theme): LayoutFrame {
  const { stage } = safeAreas(t);
  return {
    rect: { x: stage.x, y: stage.y, width: stage.width, height: (stage.width * 9) / 16 },
    avoidZones: [],
  };
}

export function item(
  key: string,
  primitive: string,
  props: Record<string, unknown>,
  zone?: string,
): PrimitiveItem {
  const definition = PRIMITIVES.get(primitive);
  if (!definition) throw new Error(`Unknown primitive ${primitive}`);
  return {
    kind: 'primitive',
    key,
    definition,
    props: definition.propsSchema.parse(props),
    events: [],
    focus: NO_FOCUS,
    layer: definition.layer ?? 'board',
    ...(zone ? { zone } : {}),
    children: [],
  };
}

export const node = (key: string, zone?: string, title = key) =>
  item(key, 'node_card', { title }, zone);
export const tag = (key: string, zone?: string, extra: Record<string, unknown> = {}) =>
  item(key, 'tag', { text: key, ...extra }, zone);
export const link = (key: string, from: string, to: string, zone?: string) =>
  item(key, 'connector', { from, to }, zone);

export function byKey(layout: BoardLayout, key: string): PlacedItem {
  const found = [...layout.items, ...layout.overlays].find((i) => i.key === key);
  if (!found) throw new Error(`No placed item ${key}`);
  return found;
}

/** Path of a placed relational item in canvas px. */
export function canvasPath(placed: PlacedItem) {
  return (placed.path ?? []).map((p) => ({
    x: placed.rect.x + p.x * placed.scale,
    y: placed.rect.y + p.y * placed.scale,
  }));
}

/**
 * The acceptance invariants: no solid overlaps another, everything (guides included) is inside
 * the frame, and nothing touches an avoid zone (a path counts where its line passes).
 */
export function expectValidBoard(layout: BoardLayout, frame: LayoutFrame): void {
  expect(overlapWarnings(layout.items)).toEqual([]);
  for (const placed of [...layout.items, ...layout.overlays]) {
    const path = placed.path ? canvasPath(placed) : undefined;
    const shape = path ? (pointsRect(path) ?? placed.rect) : placed.rect;
    expect(inside(frame.rect, shape), `${placed.key} inside the frame`).toBe(true);
    for (const zone of frame.avoidZones) {
      const hit = path ? pathCrossesRect(path, zone, 0) : overlaps(shape, zone);
      expect(hit, `${placed.key} clear of ${zone.id}`).toBe(false);
    }
  }
  for (const guide of layout.guides) {
    const points = [guide.from, guide.to];
    const r = pointsRect(points);
    expect(r && inside(frame.rect, r), 'guide inside the frame').toBe(true);
    for (const zone of frame.avoidZones) expect(pathCrossesRect(points, zone, 0)).toBe(false);
  }
}
