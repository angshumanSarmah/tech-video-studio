import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { ENDING_DRAW_SEC, endingCue } from '../ending/ending-state.ts';
import { totalFrames } from '../timing/frames.ts';

/**
 * The ending sheet (`EndingSheet`, `still:ending`): a fixture's last seconds in both formats, at
 * four moments of the ending card. Pure.
 */

export type EndingMoment = { label: string; frame: number };

/** Panel scale of the 1080×1920 canvas, and the sheet's spacing (px). */
export const ENDING_SHEET = { scale: 0.4, margin: 40, gap: 24, label: 44 } as const;

/**
 * Just before the card enters, halfway through its draw, settled, and the video's last frame.
 * Throws for a spec without an ending card.
 */
export function endingMoments(
  spec: RenderableVideoSpec,
  fps: number,
  seriesLabel: string,
): EndingMoment[] {
  const timing = effectiveTiming(spec);
  const cue = endingCue(spec, timing, fps, seriesLabel);
  if (!cue) throw new Error(`"${spec.meta.id}" has no ending card.`);
  const last = totalFrames(timing, fps) - 1;
  const at = (sec: number) => Math.min(last, cue.from + Math.round(sec * fps));
  return [
    { label: 'before', frame: Math.max(0, cue.from - 1) },
    { label: 'drawing', frame: at(ENDING_DRAW_SEC / 2) },
    { label: 'settled', frame: at(ENDING_DRAW_SEC + 0.5) },
    { label: 'last frame', frame: last },
  ];
}

/** Sheet size for `columns` moments and `rows` formats of a `canvas`-sized video. */
export function endingSheetSize(
  canvas: { width: number; height: number },
  columns: number,
  rows: number,
): { width: number; height: number } {
  const { scale, margin, gap, label } = ENDING_SHEET;
  const panel = { width: canvas.width * scale, height: canvas.height * scale };
  return {
    width: Math.round(2 * margin + columns * panel.width + (columns - 1) * gap),
    height: Math.round(2 * margin + rows * (label + panel.height) + (rows - 1) * gap),
  };
}
