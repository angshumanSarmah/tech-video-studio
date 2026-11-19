import type { CSSProperties } from 'react';
import { emphasisShadow, emphasisStroke, type EmphasisState } from '../emphasis/emphasis.ts';
import type { Theme, Tint } from '../theme/index.ts';

/**
 * The card surface shared by card-like primitives: surface washed with the tint (unless `wash` is
 * false, for cards whose content carries the colour), tinted border, and the theme's emphasis
 * (glow, or a bolder outline in mark themes; the swipe itself is a `BoxMark`).
 */
export function cardSurfaceCss(
  theme: Theme,
  tint: Tint,
  state: EmphasisState,
  { wash = true }: { wash?: boolean } = {},
): CSSProperties {
  const fill = theme.colours.surface;
  return {
    boxSizing: 'border-box',
    border: `${emphasisStroke(theme, theme.stroke.regular, state)}px solid ${tint.border}`,
    borderRadius: theme.radius.md,
    background: wash ? `linear-gradient(${tint.soft}, ${tint.soft}) ${fill}` : fill,
    boxShadow: emphasisShadow(theme, tint, state.emphasis),
  };
}

/** Text that keeps its case and never wraps (data, commands). */
export const NO_WRAP: CSSProperties = { whiteSpace: 'pre', overflow: 'hidden' };
