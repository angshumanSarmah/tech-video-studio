import type { VideoSpec } from '../shape.ts';
import { checkFormulaCards, checkLayerCoverage } from './coverage.ts';
import type { SpecIssue } from './issue.ts';
import { checkScenes } from './scenes.ts';
import { checkStory } from './story.ts';
import { checkTiming } from './timing.ts';

export * from './issue.ts';
export { BEAT_SECONDS_TOLERANCE } from './story.ts';

/**
 * Cross-reference checks on a structurally valid spec. Registry ids (primitives, patterns,
 * layouts, devices) and research note ids are checked elsewhere.
 */
export function findSpecIssues(spec: VideoSpec): SpecIssue[] {
  const coverage = checkLayerCoverage(spec);
  return [
    ...checkStory(spec),
    ...coverage,
    ...checkFormulaCards(spec),
    // Scene and timing checks assume layers line up with story beats.
    ...(coverage.length === 0 ? [...checkScenes(spec), ...checkTiming(spec)] : []),
  ];
}
