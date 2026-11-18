import type { CSSProperties } from 'react';
import type { Theme, Tint } from '../theme/index.ts';
import type { ElementState } from './element-state.ts';

/** Above this emphasis an element glows (a held `highlight` or a `pulse`). */
export const GLOW_THRESHOLD = 0.05;

/**
 * The card surface shared by card-like primitives: surface washed with the tint (unless `wash` is
 * false, for cards whose content carries the colour), tinted border, and the tint's glow while
 * emphasised.
 */
export function cardSurfaceCss(
  theme: Theme,
  tint: Tint,
  state: ElementState,
  { wash = true }: { wash?: boolean } = {},
): CSSProperties {
  const fill = theme.colours.surface;
  return {
    boxSizing: 'border-box',
    border: `${theme.stroke.regular}px solid ${tint.border}`,
    borderRadius: theme.radius.md,
    background: wash ? `linear-gradient(${tint.soft}, ${tint.soft}) ${fill}` : fill,
    boxShadow: state.emphasis > GLOW_THRESHOLD ? tint.glowShadow : 'none',
  };
}

/** Text that keeps its case and never wraps (data, commands). */
export const NO_WRAP: CSSProperties = { whiteSpace: 'pre', overflow: 'hidden' };
