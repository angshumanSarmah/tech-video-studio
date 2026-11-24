import type { Theme } from '../theme/index.ts';
import type { Analysis } from './analyse.ts';
import type { LayoutModeDefinition } from './modes.ts';
import { ASIDE } from './place/common.ts';
import { minReadableScale } from './readable.ts';
import { overlaps, pathCrossesRect } from './rect.ts';
import { boxOf, type ItemRole, type LayoutWarning, type PlacedItem } from './types.ts';

/**
 * Warnings about a placed board, for the Curator: more elements than the mode reads well with,
 * text below the readable size, and items that still overlap. Pure.
 */

/** Roles that must never overlap each other. */
export const SOLID_ROLES: readonly ItemRole[] = ['solid', 'pin'];

type Input = {
  analysis: Analysis;
  mode: LayoutModeDefinition;
  items: readonly PlacedItem[];
  scale: number;
  theme: Theme;
};

export function boardWarnings(input: Input): LayoutWarning[] {
  return [
    ...capacityWarnings(input),
    ...readabilityWarnings(input),
    ...overlapWarnings(input.items),
    ...crossingWarnings(input.analysis, input.items),
    ...coveredTextWarnings(input.analysis, input.items, input.theme),
  ];
}

function capacityWarnings({ analysis, mode }: Input): LayoutWarning[] {
  const units = analysis.units.filter((u) => u.zone !== ASIDE);
  if (units.length <= mode.maxUnits) return [];
  return [
    {
      code: 'too_many_elements',
      message: `${units.length} elements in ${mode.id}, which reads well with at most ${mode.maxUnits}. Split the beat or group elements.`,
      keys: units.map((u) => u.key),
    },
  ];
}

function readabilityWarnings({ analysis, scale, theme }: Input): LayoutWarning[] {
  const min = minReadableScale(theme);
  if (scale >= min - 1e-6 || analysis.units.length === 0) return [];
  const px = (theme.text.label.size * scale).toFixed(1);
  return [
    {
      code: 'text_too_small',
      message:
        `The board only fits at ${Math.round(scale * 100)}% (labels ${px}px; readable needs ` +
        `${Math.round(min * 100)}%). ${roomTakers(analysis)} Use fewer or smaller elements.`,
      keys: analysis.units.map((u) => u.key),
    },
  ];
}

/** How many units `roomTakers` names. */
const ROOM_TAKERS = 3;

/**
 * The widest units at full size, with what is pinned to their sides: pins left or right of a
 * unit widen it as much as the unit itself, so naming only the unit hides the cause.
 */
function roomTakers(analysis: Analysis): string {
  const n = (v: number) => Math.round(v).toLocaleString('en-US');
  const widest = [...analysis.units]
    .sort((a, b) => b.size.width - a.size.width)
    .slice(0, ROOM_TAKERS)
    .map((u) => {
      const pins = analysis.items
        .filter((i) => i.pin?.host === u.key && i.pin.side !== 'middle')
        .map((i) => `${i.key} (${i.pin?.side})`);
      const pinned = pins.length > 0 ? ` with ${pins.join(', ')} pinned to it` : '';
      return `${u.key} ${n(u.size.width)} x ${n(u.size.height)} px${pinned}`;
    });
  return (
    `Widest at full size: ${widest.join('; ')}. Pins on the left or right of an element add ` +
    'to its width, on the top or bottom to its height.'
  );
}

/** Pairs of solid items that overlap (an item never overlaps what it is pinned to: pins touch). */
export function overlapWarnings(items: readonly PlacedItem[]): LayoutWarning[] {
  const solids = items.filter((i) => SOLID_ROLES.includes(i.role));
  const warnings: LayoutWarning[] = [];
  solids.forEach((a, i) => {
    for (const b of solids.slice(i + 1)) {
      if (!overlaps(a.rect, b.rect)) continue;
      warnings.push({
        code: 'overlap',
        message: `"${a.key}" and "${b.key}" overlap.`,
        keys: [a.key, b.key],
      });
    }
  });
  return warnings;
}

/**
 * Connectors whose line passes through an element that is not one of their ends (nor pinned to
 * the connector, nor an end's pin): the line reads as going into that element. Elbow routing
 * (docs/TODO.md) would go around it.
 */
export function crossingWarnings(
  analysis: Analysis,
  items: readonly PlacedItem[],
): LayoutWarning[] {
  const solids = items.filter((i) => SOLID_ROLES.includes(i.role));
  const byKey = new Map(analysis.items.map((i) => [i.key, i]));
  return items.flatMap((placed) => {
    const source = byKey.get(placed.key);
    if (placed.role !== 'relational' || !placed.path || source?.refs.length !== 2) return [];
    const ends = new Set(source.refs.map((r) => r.id));
    const path = placed.path.map((p) => ({
      x: placed.rect.x + p.x * placed.scale,
      y: placed.rect.y + p.y * placed.scale,
    }));
    const crossed = solids.filter((s) => {
      if (ends.has(s.key)) return false;
      const host = byKey.get(s.key)?.pin?.host;
      if (host === placed.key) return false;
      return pathCrossesRect(path, s.rect);
    });
    return crossed.map((s) => ({
      code: 'connector_crosses' as const,
      message: `Connector "${placed.key}" passes through "${s.key}".`,
      keys: [placed.key, s.key],
    }));
  });
}

/**
 * Text an item draws outside its own body (a ring's rim label, `textRects`) with an element or
 * pin drawn over it: the label would show only in fragments (a stray "0" between two cards).
 */
export function coveredTextWarnings(
  analysis: Analysis,
  items: readonly PlacedItem[],
  theme: Theme,
): LayoutWarning[] {
  const byKey = new Map(analysis.items.map((i) => [i.key, i.item]));
  const solids = items.filter((i) => SOLID_ROLES.includes(i.role));
  return items.flatMap((placed) => {
    const world = byKey.get(placed.key);
    if (world?.kind !== 'primitive' || !world.definition.textRects) return [];
    const texts = world.definition.textRects(world.props, boxOf(placed), theme).map((r) => ({
      x: placed.rect.x + r.x * placed.scale,
      y: placed.rect.y + r.y * placed.scale,
      width: r.width * placed.scale,
      height: r.height * placed.scale,
    }));
    const covering = solids.filter(
      (s) => s.key !== placed.key && s.z > placed.z && texts.some((t) => overlaps(t, s.rect)),
    );
    return covering.map((s) => ({
      code: 'text_covered' as const,
      message: `"${s.key}" covers the text of "${placed.key}".`,
      keys: [placed.key, s.key],
    }));
  });
}
