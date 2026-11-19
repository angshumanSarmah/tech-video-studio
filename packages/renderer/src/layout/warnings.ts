import type { Theme } from '../theme/index.ts';
import type { Analysis } from './analyse.ts';
import type { LayoutModeDefinition } from './modes.ts';
import { ASIDE } from './place/common.ts';
import { minReadableScale } from './readable.ts';
import { overlaps, pathCrossesRect } from './rect.ts';
import type { ItemRole, LayoutWarning, PlacedItem } from './types.ts';

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
      message: `The board only fits at ${Math.round(scale * 100)}% (labels ${px}px; readable needs ${Math.round(min * 100)}%). Use fewer or smaller elements.`,
      keys: analysis.units.map((u) => u.key),
    },
  ];
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
