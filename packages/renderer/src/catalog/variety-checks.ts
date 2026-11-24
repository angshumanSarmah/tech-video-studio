import { toJsonPath, type RenderableVideoSpec, type SpecError } from '@explainer-studio/shared';

/**
 * Variety against usage history (P1C.8): the patterns a video's boards actually use, against the
 * patterns of the last exported videos (`usage_history`, kind `pattern`; the Director checks
 * only the patterns it suggested). A video may reuse `MAX_RECENT_PATTERN_REUSE` recent pattern;
 * each further one is `pattern_recently_used` at its first instance (advisory, Generator). Pure.
 */

/** Recently used patterns a video may draw before reuse is reported. */
export const MAX_RECENT_PATTERN_REUSE = 1;

export function patternVarietyWarnings(
  spec: RenderableVideoSpec,
  recentPatterns: readonly string[],
): SpecError[] {
  const recent = new Set(recentPatterns);
  const seen = new Set<string>();
  const reused: { path: string; pattern: string }[] = [];
  spec.scenes.forEach((scene, i) =>
    scene.patterns.forEach((instance, j) => {
      if (!recent.has(instance.pattern) || seen.has(instance.pattern)) return;
      seen.add(instance.pattern);
      reused.push({ path: toJsonPath(['scenes', i, 'patterns', j]), pattern: instance.pattern });
    }),
  );
  const allowed = reused.slice(0, MAX_RECENT_PATTERN_REUSE).map((r) => r.pattern);
  return reused.slice(MAX_RECENT_PATTERN_REUSE).map(({ path, pattern }) => ({
    path,
    code: 'pattern_recently_used',
    message:
      `${pattern} was used in a recent video, and this one already reuses ` +
      `${allowed.join(', ')}. Show this beat's idea with another pattern or loose primitives.`,
  }));
}
