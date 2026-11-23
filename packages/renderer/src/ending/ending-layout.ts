import type { VideoFormat } from '@explainer-studio/shared';
import { wrapText } from '../fonts/measure-text.ts';
import { cellHeight } from '../hud/title-block.ts';
import { formatAreas } from '../layout/format.ts';
import { bottom, inflate } from '../layout/rect.ts';
import { lineHeightPx } from '../primitives/measure.ts';
import type { Rect, TextStyleName, Theme, Zone } from '../theme/index.ts';
import type { EndingContent } from './ending-state.ts';

/**
 * Geometry of the ending card, a ruled table on the board frame: a header row (series and
 * number, "SPEC"), one numbered row per spec card line, then the call to action. Rows have fixed
 * heights computed here, so the component, the draw-on outline and the text checks
 * (`hudTextWarnings`) share them. Pure.
 */

/** Text styles of the card's parts. */
export const ENDING_STYLES = {
  header: 'hud',
  number: 'hud',
  line: 'chapter',
  cta: 'body',
} as const satisfies Record<string, TextStyleName>;

/** A spec card line is drawn on one line (ellipsis past it; `text_truncated` warns). */
export const ENDING_LINE_LINES = 1;

/** The call to action wraps to at most this many lines (clamped past it; `text_truncated` warns). */
export const ENDING_CTA_LINES = 3;

/** The header cell's right-hand label while the card has spec card lines. */
export const ENDING_SPEC_LABEL = 'SPEC';

export type EndingRowKind = 'header' | 'line' | 'cta';

/** One row, in the box's own px (`y` from the box's top border edge). */
export type EndingRow = { kind: EndingRowKind; y: number; height: number };

export type EndingBox = {
  /** The card, centred in `endingRegion`. */
  box: Rect;
  rows: EndingRow[];
  /** Lines the call to action takes (≤ `ENDING_CTA_LINES`); 0 without one. */
  ctaLines: number;
};

/** Widths the card's text is laid out in. */
export type EndingRooms = {
  /** The box's outer width. */
  width: number;
  /** The square cell holding a line's number. */
  numberWidth: number;
  /** A spec card line, beside its number cell. */
  line: number;
  /** The call to action, across the box. */
  cta: number;
  /** The header row: the series and number, with "SPEC" beside them. */
  header: number;
};

/**
 * Where the card may go: in `full`, the stage, cut clear of its avoid zones (the platform
 * buttons) by `space.md`, keeping the larger side; in `card`, the diagram window inset by
 * `space.sm`. Over the board, never over the HUD band or the subtitles.
 */
export function endingRegion(theme: Theme, format: VideoFormat): Rect {
  const areas = formatAreas(theme, format);
  if (areas.viewport) return inflate(areas.viewport, -theme.space.sm);
  return clearOfZones(areas.board, areas.avoidZones, theme.space.md);
}

/** `rect` cut above or below each zone it overlaps, whichever side leaves more height. */
export function clearOfZones(rect: Rect, zones: readonly Zone[], gap: number): Rect {
  return zones.reduce((area, zone) => {
    const overlapsX = zone.x < area.x + area.width && zone.x + zone.width > area.x;
    const overlapsY = zone.y < bottom(area) && bottom(zone) > area.y;
    if (!overlapsX || !overlapsY) return area;
    const above = { ...area, height: Math.max(0, zone.y - gap - area.y) };
    const belowTop = bottom(zone) + gap;
    const below = { ...area, y: belowTop, height: Math.max(0, bottom(area) - belowTop) };
    return above.height >= below.height ? above : below;
  }, rect);
}

export function endingRooms(theme: Theme, format: VideoFormat): EndingRooms {
  const width = endingRegion(theme, format).width;
  const inner = width - 2 * theme.stroke.thin;
  const pad = 2 * theme.space.sm;
  const numberWidth = cellHeight(theme);
  return {
    width,
    numberWidth,
    line: inner - numberWidth - theme.stroke.hairline - pad,
    cta: inner - pad,
    header: inner - pad,
  };
}

/**
 * Row heights, rules included: a header cell; a line row padded like the title block's cells
 * (`space.xs`); the CTA row for `ctaLines` lines, with more air (`space.sm`).
 */
export function rowHeight(theme: Theme, kind: EndingRowKind, ctaLines = 0): number {
  if (kind === 'header') return cellHeight(theme);
  const rule = theme.stroke.hairline;
  if (kind === 'line') {
    return ENDING_LINE_LINES * lineHeightPx(theme, ENDING_STYLES.line) + 2 * theme.space.xs + rule;
  }
  return ctaLines * lineHeightPx(theme, ENDING_STYLES.cta) + 2 * theme.space.sm + rule;
}

/** Lines the call to action takes at the card's width, clamped to `ENDING_CTA_LINES`. */
export function ctaLineCount(theme: Theme, format: VideoFormat, cta: string | undefined): number {
  if (!cta) return 0;
  const { lines } = wrapText(theme, ENDING_STYLES.cta, cta, endingRooms(theme, format).cta);
  return Math.min(Math.max(lines, 1), ENDING_CTA_LINES);
}

/** The card's box and rows for `content`, centred in the region. */
export function endingBox(
  theme: Theme,
  format: VideoFormat,
  content: Pick<EndingContent, 'lines' | 'cta'>,
): EndingBox {
  const region = endingRegion(theme, format);
  const ctaLines = ctaLineCount(theme, format, content.cta);
  const kinds: EndingRowKind[] = [
    'header',
    ...content.lines.map((): EndingRowKind => 'line'),
    ...(content.cta ? (['cta'] as const) : []),
  ];
  let y = theme.stroke.thin;
  const rows = kinds.map((kind) => {
    const row = { kind, y, height: rowHeight(theme, kind, ctaLines) };
    y += row.height;
    return row;
  });
  const height = Math.ceil(y + theme.stroke.thin);
  const box = {
    x: region.x,
    y: Math.round(region.y + (region.height - height) / 2),
    width: region.width,
    height,
  };
  return { box, rows, ctaLines };
}
