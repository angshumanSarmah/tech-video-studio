import { DRAWN, drawLevels, HUD_DRAW_SEC, type DrawLevels } from '../events/presets.ts';
import type { Theme } from '../theme/index.ts';

/**
 * How far the HUD's ruled frames (title block, card viewport) have drawn at `frame`: once, from
 * the start of the video, over `HUD_DRAW_SEC`, in `draw` enter style themes; `DRAWN` otherwise.
 */
export function hudDraw(theme: Theme, frame: number, fps: number): DrawLevels {
  if (theme.enter.style !== 'draw') return DRAWN;
  return drawLevels(frame / fps / HUD_DRAW_SEC);
}

/** True while a draw is still playing (the draw layer is drawn). */
export function drawing(draw: DrawLevels): boolean {
  return draw.progress < 1;
}
