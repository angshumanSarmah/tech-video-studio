import type { VideoFormat } from '@explainer-studio/shared';
import { cellHeight, titleBlockLayout } from '../hud/title-block.ts';
import {
  clearSymmetric,
  clipZones,
  exclusionZones,
  intersect,
  safeAreas,
  type Rect,
  type Theme,
  type Zone,
} from '../theme/index.ts';
import { bottom } from './rect.ts';

/**
 * Screen areas per video format, derived from the theme's safe areas (never constants).
 *
 *   full   HUD band · [headline band] · stage · subtitle band          (the stage is the board)
 *
 *   card   header region: title block (title, series, SHEET, REV, handle)
 *                         chapter header ··························· hero metric
 *                                                                     story clock
 *          diagram window (16:9, clear of every exclusion zone): a ruled viewport with a label
 *          cell top-left; the board sits inside it, below the label
 *          headline band
 *          subtitle band
 *
 * The card window takes the full width between the gutters when it fits above the highest
 * exclusion zone it would cross (the platform buttons); otherwise it keeps 16:9 and narrows,
 * centred. Its headline goes under it, so the window never shrinks for a headline.
 */

export type FormatAreas = {
  format: VideoFormat;
  /** Where boards go: the stage (full) or the diagram window (card). */
  board: Rect;
  /** The board on beats that show a headline: below the headline band in full, the window in card. */
  boardWithHeadline: Rect;
  headlineBand: Rect;
  subtitleBand: Rect;
  /** Exclusion zones clipped to the board: what the layout must keep clear (none in card). */
  avoidZones: Zone[];
  /** Card only: the persistent header region the HUD draws (title block and its rows). */
  header: Rect | null;
  /**
   * Card only: the diagram window, drawn by the HUD as a ruled viewport with a label cell in its
   * top-left corner. The board sits inside it, below the label cell (`viewportBoard`).
   */
  viewport: Rect | null;
};

/** Diagram window aspect in the card format. */
export const CARD_ASPECT = 16 / 9;

export function formatAreas(theme: Theme, format: VideoFormat): FormatAreas {
  return format === 'card' ? cardAreas(theme) : fullAreas(theme);
}

function fullAreas(theme: Theme): FormatAreas {
  const areas = safeAreas(theme);
  return {
    format: 'full',
    board: areas.stage,
    boardWithHeadline: areas.stageWithHeadline,
    headlineBand: areas.headlineBand,
    subtitleBand: areas.subtitleBand,
    avoidZones: areas.avoidZones,
    header: null,
    viewport: null,
  };
}

function cardAreas(theme: Theme): FormatAreas {
  const areas = safeAreas(theme);
  const zones = exclusionZones(theme);
  const { block, chapterRow } = titleBlockLayout(theme, 'header');
  const header = { ...block, height: bottom(chapterRow) - block.y };
  const window = cardWindow(theme, bottom(header) + theme.space.md, zones);
  const width = theme.canvas.width;
  const headlineBand = clearSymmetric(
    { ...areas.stage, y: bottom(window) + theme.space.md, height: theme.safeArea.headlineBand },
    zones,
    width,
  );
  const subtitleBand = clearSymmetric(
    {
      ...areas.stage,
      y: bottom(headlineBand) + theme.space.sm,
      height: theme.safeArea.subtitleBand,
    },
    zones,
    width,
  );
  if (bottom(subtitleBand) > bottom(areas.subtitleBand) || subtitleBand.width <= 0) {
    throw new Error(`Theme "${theme.id}": the card format's subtitle band does not fit.`);
  }
  return {
    format: 'card',
    board: viewportBoard(theme, window),
    boardWithHeadline: viewportBoard(theme, window),
    headlineBand,
    subtitleBand,
    avoidZones: clipZones(zones, window),
    header,
    viewport: window,
  };
}

/**
 * Where the board goes inside the card's viewport: clear of its border by `space.sm`, and below
 * the label cell in its top-left corner, so no element is ever drawn under the label.
 */
export function viewportBoard(theme: Theme, viewport: Rect): Rect {
  const pad = theme.space.sm;
  const top = cellHeight(theme) + pad;
  return {
    x: viewport.x + pad,
    y: viewport.y + top,
    width: viewport.width - 2 * pad,
    height: viewport.height - top - pad,
  };
}

/**
 * The largest 16:9 window from `top`, centred between the gutters, whose bottom stays `space.sm`
 * above every exclusion zone it would otherwise cross.
 */
function cardWindow(theme: Theme, top: number, zones: readonly Zone[]): Rect {
  const { stage } = safeAreas(theme);
  const full = { x: stage.x, y: top, width: stage.width, height: stage.width / CARD_ASPECT };
  const blocking = zones.filter((z) => z.y >= top && intersect({ ...full, height: 1e6 }, z));
  const limit = Math.min(bottom(full), ...blocking.map((z) => z.y - theme.space.sm));
  const height = Math.max(0, limit - top);
  // Whole px: the window is a visible frame, and its edges should land on pixels.
  const width = Math.floor(Math.min(stage.width, height * CARD_ASPECT));
  const window = {
    x: Math.round(stage.x + (stage.width - width) / 2),
    y: top,
    width,
    height: Math.floor(width / CARD_ASPECT),
  };
  if (!(window.width > 0 && window.height > 0)) {
    throw new Error(`Theme "${theme.id}": no room for the card format's diagram window.`);
  }
  return window;
}
