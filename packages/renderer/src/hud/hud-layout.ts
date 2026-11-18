import { safeAreas, type Rect, type TextStyleName, type Theme } from '../theme/index.ts';

/**
 * Fixed HUD slots, derived from the theme's safe areas and text styles (never hard-coded), so a
 * recalibrated top bar moves the whole HUD with it. Rows stack from the top of the HUD band:
 *
 *   topBar      SERIES · TOPIC                          @handle
 *   metaRow     STEP 2/3 · NAME ● ● ○              [ PILL · VALUE ]
 *   chapterRow  — 2 · CHAPTER QUESTION?          FROM → TO · 1:52
 *
 * The headline has its own band at the top of the stage (`safeAreas().headlineBand`).
 */
export type HudLayout = {
  topBar: Rect;
  metaRow: Rect;
  chapterRow: Rect;
  headline: Rect;
};

export function lineHeightPx(theme: Theme, style: TextStyleName): number {
  const { size, lineHeight } = theme.text[style];
  return Math.ceil(size * lineHeight);
}

/** Height of the hero metric pill: one label line plus vertical padding. */
export function pillHeight(theme: Theme): number {
  return lineHeightPx(theme, 'hud') + 2 * theme.space.xs;
}

export function hudLayout(theme: Theme): HudLayout {
  const { hudBand, headlineBand } = safeAreas(theme);
  const heights = [lineHeightPx(theme, 'hud'), pillHeight(theme), lineHeightPx(theme, 'chapter')];
  const gap = theme.space.md;
  const needed = heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1);
  if (needed > hudBand.height) {
    throw new Error(
      `Theme "${theme.id}": the HUD needs ${needed}px but the HUD band is ${hudBand.height}px.`,
    );
  }
  let y = hudBand.y;
  const [topBar, metaRow, chapterRow] = heights.map((height) => {
    const row = { x: hudBand.x, y, width: hudBand.width, height };
    y += height + gap;
    return row;
  }) as [Rect, Rect, Rect];
  return { topBar, metaRow, chapterRow, headline: headlineBand };
}
