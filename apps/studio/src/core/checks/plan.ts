import {
  hudTextWarnings,
  withRegistryChecks,
  type HudContext,
} from '@explainer-studio/renderer/catalog';
import { getTheme } from '@explainer-studio/renderer/theme';
import {
  bareSourceNames,
  directorPlanProblems,
  isAdvisoryPlanCode,
  previewSpec,
  specFromPlan,
  validateVideoSpec,
  VideoSpecShapeSchema,
  type DirectorCheckContext,
  type DirectorInput,
  type DirectorPlan,
  type PlanSpecContext,
  type ResearchNotes,
  type ResearchSource,
  type SpecError,
  type VideoSpec,
} from '@explainer-studio/shared';

/**
 * Every check a beat sheet must pass beyond its schema: the Director's `callJson` check and the
 * beat-sheet gate's checks on a user's edit run the same list.
 */

export interface PlanCheckDeps extends DirectorCheckContext {
  /** What turns the plan into a spec (id, series, run format, series number). */
  readonly spec: PlanSpecContext;
  /** The HUD's run context, for `text_truncated` on the title and chapter text. */
  readonly hud: HudContext;
}

/** What a plan's checks read, from the Director step's input and the run around it. */
export interface PlanCheckSources {
  readonly runId: number;
  readonly input: DirectorInput;
  readonly notes: ResearchNotes;
  /** The research step's sources: their site and library names are bare as source lines. */
  readonly sources: readonly ResearchSource[];
  readonly video: DirectorCheckContext['video'];
  readonly series: { readonly tag: string; readonly name: string; readonly label: string };
  readonly channelHandle: HudContext['channelHandle'];
}

export function planCheckDeps(s: PlanCheckSources): PlanCheckDeps {
  const { input } = s;
  return {
    notes: s.notes,
    video: s.video,
    ...(input.length.overrideSec === undefined
      ? {}
      : { lengthOverrideSec: input.length.overrideSec }),
    recentCombos: input.memory.recent.combos,
    ...(input.memory.recent.structures ? { recentStructures: input.memory.recent.structures } : {}),
    series: { name: s.series.name, label: s.series.label },
    sourceNames: bareSourceNames(s.sources),
    sources: s.sources,
    spec: {
      id: `run-${s.runId}`,
      series: s.series.tag,
      ...(input.formatOverride ? { formatOverride: input.formatOverride } : {}),
      seriesNumber: input.series.nextNumber,
    },
    hud: { seriesLabel: s.series.label, channelHandle: s.channelHandle },
  };
}

/**
 * The plan's own checks (`directorPlanProblems`), the plan as a spec (`validateVideoSpec` with the
 * registry checks: catalogue and registry ids, story references, topic-class layout modes) and
 * the HUD text it would show (title, chapter titles and questions) in the default theme. Spec
 * warnings count, except the whole-video length warning: the plan checks length per video or
 * part itself. Paths point into the plan (it is shaped like a spec).
 */
export function planIssues(plan: DirectorPlan, deps: PlanCheckDeps): SpecError[] {
  const spec = specFromPlan(plan, deps.spec);
  const result = withRegistryChecks(validateVideoSpec(spec), spec);
  const specIssues = [...result.errors, ...result.warnings].filter(
    (issue) => issue.code !== 'target_length_mismatch',
  );
  return [
    ...directorPlanProblems(plan, deps),
    ...specIssues,
    ...hudIssues(result.ok ? result.spec : specShape(spec), deps.hud),
  ].map((issue) => ({ path: issue.path, code: issue.code, message: issue.message }));
}

/**
 * The spec's structure when it fails only on cross-references (an unknown id, a keyframe on the
 * first beat), so its HUD text is still checked and every problem is reported at once.
 */
function specShape(spec: unknown): VideoSpec | undefined {
  const shape = VideoSpecShapeSchema.safeParse(spec);
  return shape.success ? shape.data : undefined;
}

/**
 * HUD text checks need a renderable spec; placeholder layers stand in for script and scenes. On a
 * spec with reference errors the HUD may not lay out (e.g. a beat in an unknown chapter): then
 * there is nothing to add until those are fixed.
 */
function hudIssues(spec: VideoSpec | undefined, hud: HudContext): SpecError[] {
  if (!spec) return [];
  try {
    return hudTextWarnings(previewSpec(spec), getTheme(), hud);
  } catch {
    return [];
  }
}

/**
 * A plan's issues by weight (P1C.10): advisory ones (`DIRECTOR_ADVISORY_CODES`) never block the
 * beat sheet and are never the reason for a Director repair; the rest block.
 */
export function splitPlanIssues<T extends { readonly code: string }>(
  issues: readonly T[],
): { blocking: T[]; warnings: T[] } {
  return {
    blocking: issues.filter((i) => !isAdvisoryPlanCode(i.code)),
    warnings: issues.filter((i) => isAdvisoryPlanCode(i.code)),
  };
}
