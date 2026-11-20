import {
  hudTextWarnings,
  withRegistryChecks,
  type HudContext,
} from '@explainer-studio/renderer/catalog';
import { getTheme } from '@explainer-studio/renderer/theme';
import {
  directorPlanProblems,
  DirectorPlanSchema,
  specFromPlan,
  validateVideoSpec,
  VideoSpecShapeSchema,
  type DirectorCheckContext,
  type PlanSpecContext,
  type RenderableVideoSpec,
  type SpecError,
  type VideoSpec,
} from '@explainer-studio/shared';
import type { OutputIssue } from '#worker/llm/types.ts';

export interface DirectorCheckDeps extends DirectorCheckContext {
  /** What turns the plan into a spec (id, series, run format, series number). */
  readonly spec: PlanSpecContext;
  /** The HUD's run context, for `text_truncated` on the title and chapter text. */
  readonly hud: HudContext;
}

/**
 * Everything the Director's answer must pass beyond its schema, as one `callJson` check: the
 * plan's own checks (`directorPlanProblems`), the plan as a spec (`validateVideoSpec` with the
 * registry checks: catalogue and registry ids, story references, topic-class layout modes) and
 * the HUD text it would show (title, chapter titles and questions) in the default theme. Spec
 * warnings count, like for every agent, except the whole-video length warning: the plan checks
 * length per video or part itself. Paths point into the plan (it is shaped like a spec).
 */
export function directorCheck(deps: DirectorCheckDeps): (value: unknown) => OutputIssue[] {
  return (value) => {
    const parsed = DirectorPlanSchema.safeParse(value);
    if (!parsed.success) return [];
    const plan = parsed.data;
    const spec = specFromPlan(plan, deps.spec);
    const result = withRegistryChecks(validateVideoSpec(spec), spec);
    const specIssues = [...result.errors, ...result.warnings].filter(
      (issue) => issue.code !== 'target_length_mismatch',
    );
    return [
      ...directorPlanProblems(plan, deps),
      ...specIssues,
      ...hudIssues(result.ok ? result.spec : specShape(spec), deps.hud),
    ].map(toOutputIssue);
  };
}

function toOutputIssue(issue: { path: string; code: string; message: string }): OutputIssue {
  return { path: issue.path, code: issue.code, message: issue.message };
}

/**
 * The spec's structure when it fails only on cross-references (an unknown id, a keyframe on the
 * first beat), so its HUD text is still checked and every problem goes into one repair.
 */
function specShape(spec: unknown): VideoSpec | undefined {
  const shape = VideoSpecShapeSchema.safeParse(spec);
  return shape.success ? shape.data : undefined;
}

/**
 * HUD text checks need a renderable spec; placeholder layers stand in for script and scenes. On a
 * spec with reference errors the HUD may not lay out (e.g. a beat in an unknown chapter): then
 * there is nothing to add, and the next attempt checks it.
 */
function hudIssues(spec: VideoSpec | undefined, hud: HudContext): SpecError[] {
  if (!spec) return [];
  try {
    return hudTextWarnings(hudPreviewSpec(spec), getTheme(), hud);
  } catch {
    return [];
  }
}

/**
 * The spec with one placeholder narration word and an empty board per beat: enough for the HUD
 * checks, which read the title, chapters and which beats each chapter spans (no headlines yet).
 */
export function hudPreviewSpec(spec: VideoSpec): RenderableVideoSpec {
  const beats = spec.story.beats;
  return {
    ...spec,
    script: beats.map((b) => ({ beatId: b.id, narration: 'placeholder', tags: [], statCards: [] })),
    scenes: beats.map((b) => ({
      beatId: b.id,
      kind: 'board',
      elements: [],
      patterns: [],
      events: [],
      focus: [],
      transitionIn: 'cut',
      continuesPrevious: false,
    })),
  };
}
