import type { FontRole, TextStyleName, Theme } from './schema.ts';

/** Plain CSS text properties (React-free so the layout engine can measure with them too). */
export type TextCss = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: string;
  lineHeight: number;
  textTransform: 'uppercase' | 'none';
};

/** The role's family, then its bundled fallbacks' families, then the system fallback. */
export function fontStack(theme: Theme, role: FontRole): string {
  const { family, fallback, bundledFallbacks } = theme.fonts[role];
  const bundled = bundledFallbacks.map((r) => `'${theme.fonts[r].family}', `).join('');
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
