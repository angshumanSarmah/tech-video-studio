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

export function fontStack(theme: Theme, role: FontRole): string {
  const { family, fallback } = theme.fonts[role];
  return `'${family}', ${fallback}`;
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
