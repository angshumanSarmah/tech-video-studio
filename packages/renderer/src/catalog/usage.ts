import {
  deviceLayoutCombo,
  hookKey,
  mainPatternSequence,
  type RenderableVideoSpec,
  type UsageKind,
} from '@explainer-studio/shared';
import { beatLayoutMode, type PatternLayouts } from '../layout/modes.ts';
import { DEFAULT_REGISTRIES } from './registries.ts';

/** One usage-history value (`usage_history` row less its run). */
export interface UsageRow {
  readonly kind: UsageKind;
  readonly value: string;
}

/**
 * What an exported video used (P1C.10), as the usage history records it: what its boards draw
 * (patterns, primitives placed directly, the layout mode of each board), its story (devices,
 * each beat's `<device>/<layout>` as the Director's combo check reads it, metaphor world, topic
 * class, ending) and its structure (`hookKey`, `mainPatternSequence` of the drawn patterns).
 * Distinct rows, sorted by kind then value (code units). Pure.
 */
export function usageOfSpec(
  spec: RenderableVideoSpec,
  patterns: PatternLayouts = DEFAULT_REGISTRIES.patterns,
): UsageRow[] {
  const { story, scenes } = spec;
  const drawnPatterns = scenes.flatMap((s) => s.patterns.map((p) => p.pattern));
  const values: [UsageKind, string | undefined][] = [
    ...[...story.devices, ...story.beats.map((b) => b.device)].map(
      (d): [UsageKind, string | undefined] => ['device', d],
    ),
    ...scenes
      .filter((s) => !s.continuesPrevious)
      .map((s): [UsageKind, string] => ['layout', beatLayoutMode(s, patterns)]),
    ...story.beats.map((b): [UsageKind, string | undefined] => [
      'device_layout',
      deviceLayoutCombo(b),
    ]),
    ...drawnPatterns.map((p): [UsageKind, string] => ['pattern', p]),
    ...scenes.flatMap((s) =>
      s.elements.map((e): [UsageKind, string] => ['primitive', e.primitive]),
    ),
    ['metaphor_world', story.metaphorWorld],
    ['topic_class', spec.meta.topicClass],
    ['hook', hookKey(story.hook.kind, story.beats)],
    ['ending', story.ending.kind],
    ['pattern_sequence', mainPatternSequence(drawnPatterns)],
  ];
  const seen = new Set<string>();
  const rows: UsageRow[] = [];
  for (const [kind, value] of values) {
    const key = `${kind}\u0000${value}`;
    if (value === undefined || seen.has(key)) continue;
    seen.add(key);
    rows.push({ kind, value });
  }
  return rows.sort((a, b) => compare(a.kind, b.kind) || compare(a.value, b.value));
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
