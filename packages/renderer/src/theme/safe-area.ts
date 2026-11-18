import { PLATFORMS, type Insets, type Theme } from './schema.ts';

export type Rect = { x: number; y: number; width: number; height: number };

export type SafeAreas = {
  canvas: Rect;
  /** Canvas minus the union of every platform's UI margins. */
  platformSafe: Rect;
  /** Top band of `platformSafe`, reserved for the HUD. */
  hudBand: Rect;
  /** Bottom band of `platformSafe`, reserved for subtitles. */
  subtitleBand: Rect;
  /** What remains between the bands (minus gaps): where the layout engine places elements. */
  stage: Rect;
};

/** Largest margin per side across all platforms, so content clears every platform's UI. */
export function unionInsets(theme: Theme): Insets {
  const all = PLATFORMS.map((p) => theme.safeArea.platforms[p]);
  const max = (side: keyof Insets) => Math.max(...all.map((i) => i[side]));
  return { top: max('top'), right: max('right'), bottom: max('bottom'), left: max('left') };
}

function inset(rect: Rect, by: Insets): Rect {
  return {
    x: rect.x + by.left,
    y: rect.y + by.top,
    width: rect.width - by.left - by.right,
    height: rect.height - by.top - by.bottom,
  };
}

export function safeAreas(theme: Theme): SafeAreas {
  const { width, height } = theme.canvas;
  const { hudBand, subtitleBand, gap } = theme.safeArea;
  const canvas = { x: 0, y: 0, width, height };
  const platformSafe = inset(canvas, unionInsets(theme));
  const { x, y, width: w, height: h } = platformSafe;
  return {
    canvas,
    platformSafe,
    hudBand: { x, y, width: w, height: hudBand },
    subtitleBand: { x, y: y + h - subtitleBand, width: w, height: subtitleBand },
    stage: inset(platformSafe, {
      top: hudBand + gap,
      bottom: subtitleBand + gap,
      left: 0,
      right: 0,
    }),
  };
}
