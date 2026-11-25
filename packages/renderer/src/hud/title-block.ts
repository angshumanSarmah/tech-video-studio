import type { PartRef } from '@explainer-studio/shared';
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
 *           (a part of a multi-part video shows PART n/N in the REV cell)
 *           metaRow    ● ● ○ (step dots)              LABEL ├── VALUE ──┤
 *           chapterRow — 2 · CHAPTER QUESTION?             FROM → TO · 1:52
 *                      (or, with the chapter header off, the current step's name)
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
 * header region (`formatAreas`), with the same chapter / metric and clock rows under the block.
 */

export const TITLE_BLOCK_VARIANTS = ['strip', 'header'] as const;
export type TitleBlockVariant = (typeof TITLE_BLOCK_VARIANTS)[number];

/** Lines the header variant's title cell always holds room for (it never grows or jumps). */
export const TITLE_LINES = 2;

/** A single video's revision cell; a part of a multi-part video shows PART n/N there instead. */
export const REVISION_LABEL = 'REV A';

/** "PART 2/3" for a part of a multi-part video (`meta.part`). */
export function partLabel(part: PartRef): string {
  return `PART ${part.index}/${part.count}`;
}

/** The revision cell's text: PART n/N for a part, else `REVISION_LABEL`. */
export function revisionLabel(part: PartRef | undefined): string {
  return part ? partLabel(part) : REVISION_LABEL;
}

export type TitleBlockLayout = {
  /** The ruled box, outer border included. */
  block: Rect;
  /** The top cell's height, its bottom divider included (subject line or title). */
  topHeight: number;
  /** The step dots (left, with the step tracker on) and the hero metric dimension (right). */
  metaRow: Rect;
  /**
   * The chapter header, or the current step's name when it is off (left), and the story clock
   * (right): nothing else shares it.
   */
  chapterRow: Rect;
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
 * Slots for a title-block variant, stacked from the top of the HUD band: the block, then the
 * chapter / metric row, then the clock row. The strip must fit the HUD band (throws otherwise,
 * like `hudLayout`); the card format's header region is as tall as the header needs.
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
  // Tight rows (xs): three rows under the two-cell block must fit the HUD band in every theme.
  const gap = theme.space.xs;
  const metaRow = row(block.y + block.height + gap, dimensionHeight(theme));
  const chapterHeight = Math.max(lineHeightPx(theme, 'chapter'), lineHeightPx(theme, 'hud'));
  const chapterRow = row(metaRow.y + metaRow.height + gap, chapterHeight);
  const needed = chapterRow.y + chapterRow.height - hudBand.y;
  // The card format's header region is as tall as it needs; its window goes below it.
  if (variant === 'strip' && needed > hudBand.height) {
    throw new Error(
      `Theme "${theme.id}": the ${variant} title block needs ${needed}px but the HUD band is ${hudBand.height}px.`,
    );
  }
  return { block, topHeight: topCellHeight(theme, variant), metaRow, chapterRow };
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

/** The card viewport's label when the chapter header is off (a drawing's detail callout). */
export const VIEWPORT_DEFAULT_LABEL = 'DETAIL A';

/**
 * The card viewport's label: the current chapter's name while the chapter header is on, else
 * `VIEWPORT_DEFAULT_LABEL`.
 */
export function viewportLabel(input: { chapterHeader: boolean; chapterTitle?: string }): string {
  return input.chapterHeader && input.chapterTitle ? input.chapterTitle : VIEWPORT_DEFAULT_LABEL;
}
