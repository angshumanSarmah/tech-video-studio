import type { DirectorPlan } from '../director/plan.ts';
import type { VideoSpec } from '../spec/shape.ts';

/**
 * A spec seen as a Director plan, so the plan checks (`directorPlanProblems`) and the script
 * checks (`scriptProblems`, which read the plan) run on a finished spec, gate edits included.
 * The spec is one video: a run of a multi-part plan is its own spec, so there are no parts.
 * `lengthReason` is not in a spec (its check is left out by the Curator). Pure.
 */
export function planOfSpec(spec: VideoSpec): DirectorPlan {
  const { title, topicClass, format, targetLengthSec } = spec.meta;
  const ending = { ...spec.story.ending };
  delete ending.seriesNumber;
  return {
    meta: { title, topicClass, format, targetLengthSec },
    story: { ...spec.story, ending },
  };
}
