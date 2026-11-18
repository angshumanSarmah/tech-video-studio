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

export function semanticTint(theme: Theme, semantic: SemanticColour): Tint {
  return tintFor(theme, theme.colours.semantic[semantic]);
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
