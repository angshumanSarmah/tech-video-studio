import {
  DEFAULT_VIDEO_SETTINGS,
  VideoSettingsSchema,
  type RunSettings,
  type VideoSettings,
} from '@explainer-studio/shared';
import { z } from 'zod';

/** Every `{{name}}` a prompt may use. Exhaustive: any other name fails the build of the prompt. */
export const PROMPT_VARIABLE_NAMES = Object.keys(
  DEFAULT_VIDEO_SETTINGS,
) as readonly (keyof VideoSettings)[];
export type PromptVariableName = keyof VideoSettings;

/** Values a prompt is filled with: one per variable. */
export type PromptVariables = VideoSettings;

export class PromptVariablesError extends Error {
  override readonly name = 'PromptVariablesError';
}

/**
 * The run's override, else the app's `settings.video` (whose schema defaults are 45, 150, 90,
 * true, 4, 2.7, beginner). The merge is validated again, so a run cannot set min above the app's max.
 */
export function resolvePromptVariables(
  run: RunSettings | undefined,
  app: VideoSettings,
): PromptVariables {
  const merged = VideoSettingsSchema.safeParse({ ...app, ...run?.video });
  if (!merged.success) {
    throw new PromptVariablesError(
      `Run length/parts/pace overrides conflict with the app settings:\n${z.prettifyError(merged.error)}`,
    );
  }
  return merged.data;
}
