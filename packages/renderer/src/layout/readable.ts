import type { Theme } from '../theme/index.ts';

/** The smallest on-canvas text (px) still readable on a phone; sets the readable scale. */
export const MIN_TEXT_PX = 18;

/** Lowest board scale at which the theme's smallest board text (labels) stays readable. */
export function minReadableScale(theme: Theme): number {
  return Math.min(1, MIN_TEXT_PX / theme.text.label.size);
}
