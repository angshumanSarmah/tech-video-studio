import {
  toJsonPath,
  type BeatScene,
  type RenderableVideoSpec,
  type SpecError,
} from '@explainer-studio/shared';

/**
 * Checks across boards (P1C.8's per-beat change rules that need neighbours), run on the assembled
 * scene layer after every beat is generated (the Generator's post-pass) and by the Curator. Two
 * consecutive beats never show the same pattern on the same focus (`pattern_repeated_on_focus`),
 * and at most `MAX_STATIC_BEATS` beat shows only a headline or a stat card (`static_beats`).
 * Warnings. Pure.
 */

/** Beats that may show nothing but a headline or stat card, per video. */
export const MAX_STATIC_BEATS = 1;

export function layerWarnings(spec: RenderableVideoSpec): SpecError[] {
  return [...patternRepeats(spec.scenes), ...staticBeats(spec.scenes)];
}

/** Ids the beat focuses: its `focus` and its focus events' targets (instances by their root). */
function focusOf(scene: BeatScene): Set<string> {
  const ids = [
    ...scene.focus,
    ...scene.events.filter((e) => e.action === 'focus').flatMap((e) => e.targets),
  ];
  return new Set(ids.map((id) => id.split('/')[0] ?? id));
}

/** Pattern ids whose instance (declared in this beat) is in its focus. */
function focusedPatterns(scene: BeatScene): Map<string, number> {
  const focus = focusOf(scene);
  const out = new Map<string, number>();
  scene.patterns.forEach((p, j) => {
    if (focus.has(p.id) && !out.has(p.pattern)) out.set(p.pattern, j);
  });
  return out;
}

function patternRepeats(scenes: readonly BeatScene[]): SpecError[] {
  return scenes.flatMap((scene, i) => {
    const previous = scenes[i - 1];
    if (!previous) return [];
    const before = focusedPatterns(previous);
    return [...focusedPatterns(scene)].flatMap(([pattern, j]) =>
      before.has(pattern)
        ? [
            {
              path: toJsonPath(['scenes', i, 'patterns', j]),
              code: 'pattern_repeated_on_focus',
              message:
                `The previous beat already shows ${pattern} as its focus. Show this beat's idea ` +
                'another way, or continue that board and move the focus.',
            },
          ]
        : [],
    );
  });
}

/** A new board that holds nothing, or only stat cards: the beat is its headline or a number. */
function isStatic(scene: BeatScene): boolean {
  if (scene.continuesPrevious || scene.patterns.length > 0) return false;
  return scene.elements.every((e) => e.primitive === 'stat_card');
}

function staticBeats(scenes: readonly BeatScene[]): SpecError[] {
  const statics = scenes.flatMap((scene, i) => (isStatic(scene) ? [i] : []));
  return statics.slice(MAX_STATIC_BEATS).map((i) => ({
    path: toJsonPath(['scenes', i]),
    code: 'static_beats',
    message:
      `At most ${MAX_STATIC_BEATS} beat may show only a headline or a stat card; this board ` +
      'needs something the narration shows happening.',
  }));
}
