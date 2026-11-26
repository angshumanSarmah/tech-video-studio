import { ACTION_DURATION_SEC, ACTION_EASING } from '../events/presets.ts';

/**
 * How much the board fades behind the ending card: its own strength, kept at the original 0.7 so
 * the card reads alone (focus dimming is lighter, `FOCUS_DIM_FADE`).
 */
export const ENDING_DIM_FADE = 0.7;

/**
 * Opacity of the board layer while the ending card shows: `1 - ENDING_DIM_FADE`, easing in over a
 * `dim` action's duration from the card's first frame. 1 without an ending card. Pure.
 */
export function endingBoardOpacity(frame: number, from: number | undefined, fps: number): number {
  if (from === undefined || frame < from) return 1;
  const t = (frame - from) / fps / ACTION_DURATION_SEC.dim;
  return 1 - ENDING_DIM_FADE * ACTION_EASING.dim(t);
}
