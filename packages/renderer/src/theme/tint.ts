import { contrastRatio, isHexColour, withAlpha } from './colour.ts';
import type { SemanticColour, Theme } from './schema.ts';

/** A colour as the theme applies it: solid, soft fill, border, and glow. */
export type Tint = {
  base: string;
  soft: string;
  border: string;
  /** For `box-shadow` / `text-shadow`. */
  glowShadow: string;
  /** For `filter` on HTML or SVG (strokes, icons). */
  glowFilter: string;
};

/** Applies the theme's tint and glow rules to any hex colour. */
export function tintFor(theme: Theme, hex: string): Tint {
  const { innerBlur, innerAlpha, outerBlur, outerAlpha } = theme.glow;
  const inner = withAlpha(hex, innerAlpha);
  const outer = withAlpha(hex, outerAlpha);
  return {
    base: hex,
    soft: withAlpha(hex, theme.tint.softAlpha),
    border: withAlpha(hex, theme.tint.borderAlpha),
    glowShadow: `0 0 ${innerBlur}px ${inner}, 0 0 ${outerBlur}px ${outer}`,
    glowFilter: `drop-shadow(0 0 ${innerBlur}px ${inner}) drop-shadow(0 0 ${outerBlur}px ${outer})`,
  };
}

/** The colour a semantic fills with: the theme's `tint.fills` override, else the semantic colour. */
export function semanticFillColour(theme: Theme, semantic: SemanticColour): string {
  return theme.tint.fills[semantic]?.colour ?? theme.colours.semantic[semantic];
}

/**
 * A semantic fill at a primitive's own strength (`alpha`): the theme decides the colour (so focus
 * fills with the highlighter on paper), the primitive decides how strong (rest vs emphasised).
 * Use it instead of `withAlpha(tint.base, …)` for any semantic wash, area or track.
 */
export function semanticFill(theme: Theme, semantic: SemanticColour, alpha: number): string {
  return withAlpha(semanticFillColour(theme, semantic), alpha);
}

/** A semantic's tint; its soft fill comes from `tint.fills` when the theme overrides it. */
export function semanticTint(theme: Theme, semantic: SemanticColour): Tint {
  const tint = tintFor(theme, theme.colours.semantic[semantic]);
  const fill = theme.tint.fills[semantic];
  return fill ? { ...tint, soft: withAlpha(fill.colour, fill.alpha) } : tint;
}

/**
 * Series accents are data (DB `series.accent_colour`), passed to compositions as props. Missing or
 * invalid values fall back to the theme's accent so a render never fails on a bad setting.
 */
export function resolveAccent(theme: Theme, accent: string | null | undefined): string {
  return accent && isHexColour(accent) ? accent : theme.colours.fallbackAccent;
}

export type AccentContrast = { ratio: number; minimum: number; ok: boolean };

/**
 * Contrast of an accent against the theme background. Accents colour text (series label, karaoke
 * highlight), so the text minimum applies. For the Settings UI's low-contrast warning.
 */
export function checkAccentContrast(theme: Theme, accent: string): AccentContrast {
  const ratio = contrastRatio(accent, theme.colours.background);
  const minimum = theme.minimumContrast.text;
  return { ratio, minimum, ok: ratio >= minimum };
}
