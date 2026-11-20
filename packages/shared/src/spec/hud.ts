import { z } from 'zod';
import type { DeviceId } from '../catalogues/devices.ts';

/**
 * Story devices that decide how chapters are shown. These are device catalogue ids (P1C.4); the
 * catalogue must use the same ids.
 */
export const CHAPTER_DISPLAY_DEVICES = {
  questionChapters: 'question_chapters',
  roadmap: 'roadmap',
} as const satisfies Record<string, DeviceId>;

/** `auto` lets the story devices decide; true/false is a user override at a gate and wins. */
export const AutoToggleSchema = z.union([z.boolean(), z.literal('auto')]);
export type AutoToggle = z.infer<typeof AutoToggleSchema>;

/**
 * Per-video HUD toggles. A part that is on but has no data (no hero metric, no story clock, no
 * headline on a beat) is not drawn. Chapter header and step tracker both show the chapter, so by
 * default (`auto`) only one of them is on: see `resolveHud`.
 */
export const HudSchema = z.strictObject({
  topBar: z.boolean().default(true),
  chapterHeader: AutoToggleSchema.default('auto'),
  stepTracker: AutoToggleSchema.default('auto'),
  heroMetric: z.boolean().default(true),
  storyClock: z.boolean().default(true),
  headline: z.boolean().default(true),
});
export type Hud = z.infer<typeof HudSchema>;
export type HudPart = keyof Hud;
export const HUD_PARTS = Object.keys(HudSchema.shape) as HudPart[];

/** HUD toggles with every `auto` resolved. */
export type ResolvedHud = Record<HudPart, boolean>;

/**
 * Resolves `auto` from the story devices: question-driven chapters show the chapter header only;
 * a roadmap, or any other story, shows the step tracker only. Explicit true/false wins.
 */
export function resolveHud(hud: Hud, devices: readonly string[]): ResolvedHud {
  const questions = devices.includes(CHAPTER_DISPLAY_DEVICES.questionChapters);
  return {
    ...hud,
    chapterHeader: resolveToggle(hud.chapterHeader, questions),
    stepTracker: resolveToggle(hud.stepTracker, !questions),
  };
}

function resolveToggle(toggle: AutoToggle, auto: boolean): boolean {
  return toggle === 'auto' ? auto : toggle;
}
