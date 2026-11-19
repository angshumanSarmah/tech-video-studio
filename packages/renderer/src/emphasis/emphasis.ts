import type { CSSProperties } from 'react';
import type { PartState } from '../primitives/element-state.ts';
import type { Size } from '../primitives/types.ts';
import {
  semanticFillColour,
  semanticTint,
  withAlpha,
  type SemanticColour,
  type Theme,
  type Tint,
} from '../theme/index.ts';

/**
 * The one place emphasis (`highlight`, `pulse`) becomes pixels, for every primitive and HUD part.
 * The theme picks the style (`theme.emphasis.style`):
 * - `glow`: the theme's glow while emphasised; outlines and lines keep the primitive's own widths.
 * - `mark`: a highlighter swipe (the focus fill) behind the element and a bold outline while
 *   highlighted; a thin ink ripple that spreads and fades on pulse. No glow.
 * Both styles keep the pulse bump in scale (`stateStyle`). Pure: `Mark.tsx` draws the marks.
 */

/** Above this level an element counts as emphasised (glows in `glow` themes, labels take colour). */
export const EMPHASIS_THRESHOLD = 0.05;

/** How far a mark swipe reaches past the element, in px. */
export const MARK_OVERHANG = 8;

/** A swipe is laid on slightly askew, like a hand-drawn highlighter stroke. */
export const MARK_ANGLE_DEG = -1;

/** Corner radius of a swipe's ends, in px: slightly rounded, like a chisel tip. */
export const MARK_RADIUS = 10;

/** Above this width or height (px) a box gets a frame mark along its border, not a full swipe. */
export const MARK_FRAME_MIN = 360;

/** Width of a frame mark's highlighter band, in px, centred on the element's border. */
export const MARK_FRAME_BAND = 14;

/** How far the pulse ripple travels past the swipe edge, in px. */
export const RIPPLE_SPREAD = 28;

/** The emphasis fields of an element or part state. */
export type EmphasisState = Pick<PartState, 'emphasis' | 'highlight' | 'actions'>;

export function isMarkTheme(theme: Theme): boolean {
  return theme.emphasis.style === 'mark';
}

/** `box-shadow` / `text-shadow`: the tint's glow above `threshold` in glow themes, else none. */
export function emphasisShadow(
  theme: Theme,
  tint: Tint,
  level: number,
  threshold = EMPHASIS_THRESHOLD,
): string {
  return !isMarkTheme(theme) && level > threshold ? tint.glowShadow : 'none';
}

/** CSS / SVG `filter`: the tint's glow above the threshold in glow themes, else undefined. */
export function emphasisFilter(
  theme: Theme,
  tint: Tint,
  level: number,
  threshold = EMPHASIS_THRESHOLD,
): string | undefined {
  return !isMarkTheme(theme) && level > threshold ? tint.glowFilter : undefined;
}

/** An outline of `rest` px: in mark themes it thickens by (bold − regular) as it is highlighted. */
export function emphasisStroke(theme: Theme, rest: number, state: EmphasisState): number {
  if (!isMarkTheme(theme)) return rest;
  return rest + (theme.stroke.bold - theme.stroke.regular) * state.highlight;
}

/**
 * A line's width. Glow themes keep the primitive's own emphasised width (`glow`); mark themes
 * thicken `rest` by (bold − regular) as it is highlighted (regular → bold for a regular line).
 */
export function emphasisLineWidth(
  theme: Theme,
  state: EmphasisState,
  widths: { rest: number; glow: number },
): number {
  return isMarkTheme(theme) ? emphasisStroke(theme, widths.rest, state) : widths.glow;
}

/** What a mark shows: the swipe's opacity and the ripple, if any. Null when nothing is drawn. */
export type MarkView = {
  /** 0..1: swipe opacity, from the held highlight. */
  swipe: number;
  /** Pulse ripple: px past the swipe edge and opacity; absent outside a pulse. */
  ripple?: { spread: number; opacity: number };
};

/** Mark levels: `highlight` (held, 0..1) and `pulse` (the latest pulse's progress, 0..1). */
export type MarkLevels = { highlight: number; pulse?: number | undefined };

/**
 * The levels a mark reads from an element or part state. A `recover` that is playing ripples like
 * a pulse (the settle back into the element's own colour).
 */
export function markLevels(state: EmphasisState): MarkLevels {
  const recover = state.actions.recover;
  const settling = recover !== undefined && recover > 0 && recover < 1;
  return { highlight: state.highlight, pulse: settling ? recover : state.actions.pulse };
}

/** The mark to draw at these levels; null in glow themes or when neither level shows. */
export function markView(theme: Theme, levels: MarkLevels): MarkView | null {
  if (!isMarkTheme(theme)) return null;
  const ripple = rippleAt(levels.pulse);
  if (levels.highlight <= 0 && !ripple) return null;
  return ripple ? { swipe: levels.highlight, ripple } : { swipe: levels.highlight };
}

/** The ripple spreads and fades over one pulse; none before it starts or once it has played. */
function rippleAt(progress: number | undefined): MarkView['ripple'] {
  if (progress === undefined || progress <= 0 || progress >= 1) return undefined;
  return { spread: RIPPLE_SPREAD * progress, opacity: 1 - progress };
}

/** The swipe colour: the theme's focus fill (a yellow highlighter on paper). */
export function markFill(theme: Theme): string {
  return semanticTint(theme, 'focus').soft;
}

/**
 * Style for an element that hosts a box mark: positioned (the mark is absolute) and isolated, so
 * the mark paints over the element's own background but under its content. Empty in glow themes,
 * so their output is untouched. Spread it before the element's own `position`.
 */
export function markHostCss(theme: Theme): CSSProperties {
  return isMarkTheme(theme) ? { position: 'relative', isolation: 'isolate' } : {};
}

/** A box mark's shape: a full swipe, or a frame along the border for large elements. */
export type MarkShape = 'swipe' | 'frame';

/** `frame` when either side of `size` exceeds `MARK_FRAME_MIN`; `swipe` otherwise or unsized. */
export function markShape(size: Size | undefined): MarkShape {
  if (!size) return 'swipe';
  return size.width > MARK_FRAME_MIN || size.height > MARK_FRAME_MIN ? 'frame' : 'swipe';
}

/** Resting focus underline: the lower share of the text box it covers. */
export const UNDERLINE_HEIGHT = 0.45;

/** Resting focus underline opacity: lighter than a highlight swipe. */
export const UNDERLINE_ALPHA = 0.45;

/** How far the underline reaches past the text on each side, in px. */
export const UNDERLINE_OVERHANG = 6;

/** Corner radius of the underline's ends, in px. */
export const UNDERLINE_RADIUS = 6;

/** What a resting focus underline draws: its band colour. */
export type UnderlineView = { fill: string };

/**
 * The resting underline for text drawn in `semantic`: only in mark themes, only for `focus`, and
 * only while the element is not highlighted (the highlight swipe replaces it, never both).
 */
export function focusUnderlineView(
  theme: Theme,
  semantic: SemanticColour,
  highlight = 0,
): UnderlineView | null {
  if (!isMarkTheme(theme) || semantic !== 'focus' || highlight > 0) return null;
  return { fill: withAlpha(semanticFillColour(theme, 'focus'), UNDERLINE_ALPHA) };
}
