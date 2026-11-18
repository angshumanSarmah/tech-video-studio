import type { VideoSpec } from '../shape.ts';
import { findDuplicateIds, unknownReference, type SpecIssue } from './issue.ts';

type PerBeatLayer = 'script' | 'scenes';

/**
 * A per-beat layer (`script`, `scenes`, `timing.beats`) has exactly one entry per story beat,
 * in story order. `path` locates the layer's array.
 */
export function checkBeatCoverage(
  spec: VideoSpec,
  entries: readonly { beatId: string }[],
  path: SpecIssue['path'],
): SpecIssue[] {
  const storyIds = spec.story.beats.map((b) => b.id);
  const known = new Set(storyIds);
  const present = new Set(entries.map((e) => e.beatId));
  const issues: SpecIssue[] = [
    ...findDuplicateIds(
      entries.map((e) => e.beatId),
      (i) => [...path, i, 'beatId'],
    ),
    ...entries.flatMap((e, i) =>
      known.has(e.beatId) ? [] : [unknownReference([...path, i, 'beatId'], 'beat', e.beatId)],
    ),
    ...storyIds
      .filter((id) => !present.has(id))
      .map((id): SpecIssue => ({
        path,
        code: 'missing_beat',
        message: `No entry for beat "${id}".`,
      })),
  ];
  if (issues.length > 0) return issues;
  return entries.flatMap((e, i): SpecIssue[] =>
    e.beatId === storyIds[i]
      ? []
      : [
          {
            path: [...path, i, 'beatId'],
            code: 'beat_order',
            message: `Expected beat "${storyIds[i]}" here; entries follow story beat order.`,
          },
        ],
  );
}

export function checkLayerCoverage(spec: VideoSpec): SpecIssue[] {
  const layers: PerBeatLayer[] = ['script', 'scenes'];
  return layers.flatMap((layer) => {
    const entries = spec[layer];
    return entries ? checkBeatCoverage(spec, entries, [layer]) : [];
  });
}

/** Locked decision: at most one formula card per video. */
export function checkFormulaCards(spec: VideoSpec): SpecIssue[] {
  const withFormula = (spec.script ?? []).flatMap((beat, i) => (beat.formulaCard ? [i] : []));
  return withFormula.slice(1).map((i) => ({
    path: ['script', i, 'formulaCard'],
    code: 'too_many_formula_cards',
    message: 'At most one formula card per video.',
  }));
}
