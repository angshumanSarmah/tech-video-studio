import { safeAreas, type Rect, type Theme } from '../theme/index.ts';
import { lineHeightPx } from './hud-layout.ts';

/**
 * The HUD as an engineering drawing's title block (`hud.style: 'title-block'`), in two variants:
 *
 *   strip   ┌────────────────────────────────────────────────────────────┐
 *           │ SERIES · TOPIC                                             │
 *           ├───────────────────────────────────────────┬───────┬────────┤
 *           │ SHEET 2/3                                 │ REV A │ @handle│
 *           └───────────────────────────────────────────┴───────┴────────┘
 *           metaRow   — 2 · CHAPTER QUESTION?        LABEL ├── VALUE ──┤
 *           clockRow                                    FROM → TO · 1:52
 *
 *   header  ┌────────────────────────────────────────────────────────────┐
 *           │ VIDEO TITLE, UP TO                                         │
 *           │ TWO LINES                                                  │
 *           ├──────────────────────────────┬───────────┬───────┬──────────┤
 *           │ SERIES                       │ SHEET 2/3 │ REV A │ @handle  │
 *           └──────────────────────────────┴───────────┴───────┴──────────┘
 *
 * Both variants share the bottom row of cells and differ only in the top cell: one HUD line in the
 * strip (one row of four cells cannot hold a real title at a readable size), the title in display
 * type in the header. `strip` is the full-format HUD. `header` is the card format's persistent
 * header (P1A.9): it draws only the block; the card layout places the metric and chapter itself.
 */

export const TITLE_BLOCK_VARIANTS = ['strip', 'header'] as const;
export type TitleBlockVariant = (typeof TITLE_BLOCK_VARIANTS)[number];

/** Lines the header variant's title cell always holds room for (it never grows or jumps). */
export const TITLE_LINES = 2;

/** Constant until runs carry an episode number (docs/TODO.md). */
export const REVISION_LABEL = 'REV A';

export type TitleBlockLayout = {
  /** The ruled box, outer border included. */
  block: Rect;
  /** The top cell's height, its bottom divider included (subject line or title). */
  topHeight: number;
  /** Strip variant: chapter header (left) and the hero metric dimension (right). */
  metaRow: Rect | null;
  /** Strip variant: the story clock (right). */
  clockRow: Rect | null;
};

/** One row of cells: a HUD text line plus vertical padding. */
export function cellHeight(theme: Theme): number {
  return lineHeightPx(theme, 'hud') + 2 * theme.space.xs;
}

/** The top cell: the strip's subject line, or the header's two title lines; plus its divider. */
export function topCellHeight(theme: Theme, variant: TitleBlockVariant): number {
  const text =
    variant === 'header' ? TITLE_LINES * lineHeightPx(theme, 'title') : lineHeightPx(theme, 'hud');
  return text + 2 * theme.space.xs + theme.stroke.hairline;
}

/** The hero metric dimension: the value line, with ticks as tall as a cell. */
export function dimensionHeight(theme: Theme): number {
  return cellHeight(theme);
}

function blockHeight(theme: Theme, variant: TitleBlockVariant): number {
  return Math.ceil(topCellHeight(theme, variant) + cellHeight(theme) + 2 * theme.stroke.thin);
}

/**
 * Slots for a title-block variant, stacked from the top of the HUD band. Throws when they do not
 * fit in it, like `hudLayout`.
 */
export function titleBlockLayout(theme: Theme, variant: TitleBlockVariant): TitleBlockLayout {
  const { hudBand } = safeAreas(theme);
  const row = (y: number, height: number): Rect => ({
    x: hudBand.x,
    y,
    width: hudBand.width,
    height,
  });
  const block = row(hudBand.y, blockHeight(theme, variant));
  const gap = theme.space.sm;
  const metaHeight = Math.max(lineHeightPx(theme, 'chapter'), dimensionHeight(theme));
  const metaRow = variant === 'strip' ? row(block.y + block.height + gap, metaHeight) : null;
  const clockRow = metaRow
    ? row(metaRow.y + metaRow.height + gap, lineHeightPx(theme, 'hud'))
    : null;
  const last = clockRow ?? block;
  const needed = last.y + last.height - hudBand.y;
  if (needed > hudBand.height) {
    throw new Error(
      `Theme "${theme.id}": the ${variant} title block needs ${needed}px but the HUD band is ${hudBand.height}px.`,
    );
  }
  return { block, topHeight: topCellHeight(theme, variant), metaRow, clockRow };
}

export type TitleBlockCellId = 'series' | 'sheet' | 'revision' | 'handle';

export type TitleBlockCellsInput = {
  variant: TitleBlockVariant;
  /** Show the SHEET cell: the step tracker is visible and there is a current chapter. */
  sheet: boolean;
  channelHandle: string | null;
};

/**
 * The cells of the bottom row, left to right; the first one grows. The header names the series
 * here (the strip's top cell already does).
 */
export function titleBlockCells(input: TitleBlockCellsInput): TitleBlockCellId[] {
  const { variant, sheet, channelHandle } = input;
  return [
    ...(variant === 'header' ? (['series'] as const) : []),
    ...(sheet ? (['sheet'] as const) : []),
    'revision',
    ...(channelHandle ? (['handle'] as const) : []),
  ];
}

/** "SHEET 2/3" for the chapter at 0-based `index` of `count`. */
export function sheetLabel(index: number, count: number): string {
  return `SHEET ${index + 1}/${count}`;
}
