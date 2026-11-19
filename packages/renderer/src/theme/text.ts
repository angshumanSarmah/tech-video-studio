import {
  BUNDLED_FONTS,
  type BundledFontKey,
  type FontRole,
  type TextStyleName,
  type Theme,
} from './schema.ts';

/** Plain CSS text properties (React-free so the layout engine can measure with them too). */
export type TextCss = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: string;
  lineHeight: number;
  textTransform: 'uppercase' | 'none';
};

export type BundledFont = {
  key: BundledFontKey;
  family: string;
  files: Theme['fonts'][FontRole]['files'];
};

/** One bundled face of the theme (a role or `glyphFallback`); undefined when the theme has none. */
export function bundledFont(theme: Theme, key: BundledFontKey): BundledFont | undefined {
  const face = theme.fonts[key];
  return face ? { key, family: face.family, files: face.files } : undefined;
}

/** Every face the theme bundles: the roles, then `glyphFallback` when it has one. */
export function bundledFonts(theme: Theme): BundledFont[] {
  return BUNDLED_FONTS.flatMap((key) => bundledFont(theme, key) ?? []);
}

/** The role's family, then its bundled fallbacks' families, then the system fallback. */
export function fontStack(theme: Theme, role: FontRole): string {
  const { family, fallback, bundledFallbacks } = theme.fonts[role];
  const bundled = bundledFallbacks
    .flatMap((key) => bundledFont(theme, key) ?? [])
    .map((f) => `'${f.family}', `)
    .join('');
  return `'${family}', ${bundled}${fallback}`;
}

export function textCss(theme: Theme, name: TextStyleName): TextCss {
  const style = theme.text[name];
  return {
    fontFamily: fontStack(theme, style.font),
    fontSize: style.size,
    fontWeight: style.weight,
    letterSpacing: `${style.letterSpacing}em`,
    lineHeight: style.lineHeight,
    textTransform: style.uppercase ? 'uppercase' : 'none',
  };
}
