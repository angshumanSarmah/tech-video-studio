import { DirectorPlanSchema } from '@explainer-studio/shared';
import { planIssues, type PlanCheckDeps } from '#core/checks/plan.ts';
import type { OutputIssue } from '#worker/llm/types.ts';

export type DirectorCheckDeps = PlanCheckDeps;

/**
 * Everything the Director's answer must pass beyond its schema, as one `callJson` check
 * (`planIssues`, which the beat-sheet gate runs on a user's edit too).
 */
export function directorCheck(deps: DirectorCheckDeps): (value: unknown) => OutputIssue[] {
  return (value) => {
    const parsed = DirectorPlanSchema.safeParse(value);
    return parsed.success ? planIssues(parsed.data, deps) : [];
  };
}
