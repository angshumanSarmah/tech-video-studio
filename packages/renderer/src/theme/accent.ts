import { contrastRatio, parseHex, relativeLuminance } from './colour.ts';
import type { Theme } from './schema.ts';
import { resolveAccent } from './tint.ts';

/**
 * Series accents are data, picked once per series; themes differ in background. `accentFor`
 * keeps an accent readable on any theme: when it misses the theme's text contrast minimum, its
 * OKLCH lightness moves toward the ink (hue kept; chroma only reduced where sRGB cannot hold it)
 * until it passes. Pure and deterministic: fixed iterations, no randomness, same input → same
 * output. React-free (layout engine, studio Settings).
 */

type Oklch = { l: number; c: number; h: number };
type Rgb01 = { r: number; g: number; b: number };

/** Bisection steps: far below one 8-bit step of lightness. */
const STEPS = 32;

/** The accent to draw for a stored series accent: resolved (fallback), then adapted. */
export function seriesAccent(theme: Theme, stored: string | null | undefined): string {
  return accentFor(theme, resolveAccent(theme, stored));
}

/**
 * `hex` unchanged when it already meets the theme's text minimum against the background;
 * otherwise the closest lightness toward the ink that does (as `#rrggbb`).
 */
export function accentFor(theme: Theme, hex: string): string {
  const background = theme.colours.background;
  const minimum = theme.minimumContrast.text;
  if (contrastRatio(hex, background) >= minimum) return hex;
  const from = toOklch(parseHex(hex));
  const darker = relativeLuminance(theme.colours.ink.primary) < relativeLuminance(background);
  const passes = (l: number) =>
    contrastRatio(toHex(inGamut({ ...from, l })), background) >= minimum;
  const target = darker ? 0 : 1;
  if (!passes(target)) return theme.colours.ink.primary;
  // Smallest move from the original lightness toward `target` that passes.
  let fail = from.l;
  let pass = target;
  for (let i = 0; i < STEPS; i += 1) {
    const mid = (fail + pass) / 2;
    if (passes(mid)) pass = mid;
    else fail = mid;
  }
  return toHex(inGamut({ ...from, l: pass }));
}

/** Reduces chroma (hue and lightness kept) until the colour fits sRGB. */
function inGamut(colour: Oklch): Rgb01 {
  const rgb = toRgb(colour);
  if (fits(rgb)) return rgb;
  let low = 0;
  let high = colour.c;
  for (let i = 0; i < STEPS; i += 1) {
    const mid = (low + high) / 2;
    if (fits(toRgb({ ...colour, c: mid }))) low = mid;
    else high = mid;
  }
  return toRgb({ ...colour, c: low });
}

function fits({ r, g, b }: Rgb01): boolean {
  return [r, g, b].every((v) => v >= 0 && v <= 1);
}

function toHex({ r, g, b }: Rgb01): string {
  const byte = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** sRGB (0–255) to OKLCH (Björn Ottosson's OKLab). */
function toOklch({ r, g, b }: { r: number; g: number; b: number }): Oklch {
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

/** OKLCH to sRGB in 0–1 (unclamped, so callers can test the gamut). */
function toRgb({ l: L, c, h }: Oklch): Rgb01 {
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}
