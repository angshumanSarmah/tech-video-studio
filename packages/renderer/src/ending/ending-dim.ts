import { ACTION_DURATION_SEC, ACTION_EASING, dimOpacity } from '../events/presets.ts';

/**
 * Opacity of the board layer while the ending card shows: it dims like the board behind an
 * overlay (`DIM_FADE`), easing in over a `dim` action's duration from the card's first frame.
 * 1 without an ending card. Pure.
 */
export function endingBoardOpacity(frame: number, from: number | undefined, fps: number): number {
  if (from === undefined || frame < from) return 1;
  const t = (frame - from) / fps / ACTION_DURATION_SEC.dim;
  return dimOpacity(ACTION_EASING.dim(t));
}
