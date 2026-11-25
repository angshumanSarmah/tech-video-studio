import { DirectorPlanSchema, isAdvisoryPlanCode } from '@explainer-studio/shared';
import { planIssues, type PlanCheckDeps } from '#core/checks/plan.ts';
import type { OutputIssue } from '#worker/llm/types.ts';

export type DirectorCheckDeps = PlanCheckDeps;

/**
 * Everything the Director's answer must pass beyond its schema, as one `callJson` check
 * (`planIssues`, which the beat-sheet gate runs on a user's edit too). Advisory issues
 * (`hook_repeated`) are soft: listed in a repair turn, never the reason for one.
 */
export function directorCheck(deps: DirectorCheckDeps): (value: unknown) => OutputIssue[] {
  return (value) => {
    const parsed = DirectorPlanSchema.safeParse(value);
    if (!parsed.success) return [];
    return planIssues(parsed.data, deps).map((issue) =>
      isAdvisoryPlanCode(issue.code) ? { ...issue, soft: true } : issue,
    );
  };
}
