import { VIDEO_LENGTH_LIMITS_SEC } from '../config/video.ts';
import type { BeatScriptInput } from '../spec/script.ts';
import { VIDEO_SPEC_SCHEMA_VERSION, type VideoSpecInput } from '../spec/shape.ts';
import type { PartRef, VideoFormat } from '../spec/meta.ts';
import type { DirectorPlan } from './plan.ts';

/** What code adds to a plan to make it a spec: values the model never chooses. */
export interface PlanSpecContext {
  /** `meta.id`, a slug. */
  readonly id: string;
  /** `meta.series` (the series tag). */
  readonly series: string;
  /** The run's `settings.format`; the plan's recommendation when absent. */
  readonly formatOverride?: VideoFormat;
  /** Shown with the spec card ("System Design #12"). */
  readonly seriesNumber?: number;
  /** A part run's place in its video (`meta.part`: the title block's PART n/N). */
  readonly part?: PartRef;
}

/**
 * The plan as a VideoSpec (meta + story), for validation and as the first spec version of a
 * single video. A multi-part plan becomes one spec over every beat (the per-part split is
 * P1C.9's); its `targetLengthSec` is then the parts' total clamped to the hard limits, so the
 * whole-video length warning does not apply to it (the Director checks each part instead).
 */
export function specFromPlan(plan: DirectorPlan, ctx: PlanSpecContext): VideoSpecInput {
  const { story } = plan;
  return {
    schemaVersion: VIDEO_SPEC_SCHEMA_VERSION,
    meta: {
      id: ctx.id,
      series: ctx.series,
      title: plan.meta.title,
      topicClass: plan.meta.topicClass,
      targetLengthSec: planTargetLengthSec(plan),
      format: ctx.formatOverride ?? plan.meta.format,
      ...(ctx.part ? { part: ctx.part } : {}),
    },
    story: {
      ...story,
      ending: {
        ...story.ending,
        ...(ctx.seriesNumber === undefined ? {} : { seriesNumber: ctx.seriesNumber }),
      },
    },
  };
}

/**
 * The plan and the Scriptwriter's script as one spec: the run's spec before TTS (P1C.9 saves it
 * as version 1). The script must cover the plan's beats in order; `validateVideoSpec` reports
 * where it does not.
 */
export function assembleScriptedSpec(
  plan: DirectorPlan,
  script: readonly BeatScriptInput[],
  ctx: PlanSpecContext,
): VideoSpecInput {
  return { ...specFromPlan(plan, ctx), script: [...script] };
}

/** The single video's target, else the sum of the parts' (or of the beats'), within the limits. */
export function planTargetLengthSec(plan: DirectorPlan): number {
  const total =
    (plan.parts ? undefined : plan.meta.targetLengthSec) ??
    (plan.parts ?? plan.story.beats).reduce(
      (sum, item) => sum + ('targetLengthSec' in item ? item.targetLengthSec : item.targetSec),
      0,
    );
  const { min, max } = VIDEO_LENGTH_LIMITS_SEC;
  return Math.min(max, Math.max(min, Math.round(total)));
}
