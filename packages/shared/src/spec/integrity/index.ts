import type { VideoSpec } from '../shape.ts';
import { checkFormulaCards, checkLayerCoverage } from './coverage.ts';
import { findDuplicateIds, type SpecIssue } from './issue.ts';
import { checkScenes } from './scenes.ts';
import { checkScript } from './script.ts';
import { checkStory } from './story.ts';
import { checkTiming } from './timing.ts';

export * from './issue.ts';
export { anchorProblem } from './scenes.ts';
export { findSpecWarnings, TARGET_LENGTH_TOLERANCE } from './warnings.ts';

/**
 * Cross-reference errors on a structurally valid spec. Registry ids (primitives, patterns,
 * layouts, devices) and research note ids are checked elsewhere.
 */
export function findSpecErrors(spec: VideoSpec): SpecIssue[] {
  const coverage = checkLayerCoverage(spec);
  return [
    ...checkStory(spec),
    ...findDuplicateIds(
      (spec.logos ?? []).map((l) => l.id),
      (i) => ['logos', i, 'id'],
    ),
    ...coverage,
    ...checkFormulaCards(spec),
    ...checkScript(spec),
    // Scene and timing checks assume layers line up with story beats.
    ...(coverage.length === 0 ? [...checkScenes(spec), ...checkTiming(spec)] : []),
  ];
}
