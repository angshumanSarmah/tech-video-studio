import { DEFAULT_VIDEO_SETTINGS, type VideoSettings } from '@explainer-studio/shared';

/** Every `{{name}}` a prompt may use. Exhaustive: any other name fails the build of the prompt. */
export const PROMPT_VARIABLE_NAMES = Object.keys(
  DEFAULT_VIDEO_SETTINGS,
) as readonly (keyof VideoSettings)[];
export type PromptVariableName = keyof VideoSettings;

/** Values a prompt is filled with: one per variable (a run's `resolvedSettings.video`). */
export type PromptVariables = VideoSettings;
