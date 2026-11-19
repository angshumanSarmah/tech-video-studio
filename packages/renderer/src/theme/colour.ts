import { HexColourSchema } from './schema.ts';

type Rgb = { r: number; g: number; b: number };

export function isHexColour(value: string): boolean {
  return HexColourSchema.safeParse(value).success;
}

export function parseHex(hex: string): Rgb {
  if (!isHexColour(hex)) throw new Error(`Invalid hex colour "${hex}"`);
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** CSS colour with alpha, e.g. `rgb(79 140 255 / 0.07)`. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** The opaque colour of `hex` at `alpha` painted over `under` (for contrast checks on fills). */
export function blendOver(hex: string, alpha: number, under: string): string {
  const top = parseHex(hex);
  const bottom = parseHex(under);
  const mix = (t: number, u: number) => u + alpha * (t - u);
  return toHex({ r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b) });
}
