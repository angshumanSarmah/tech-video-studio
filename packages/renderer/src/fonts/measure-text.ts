import {
  bundledFont,
  type BundledFontKey,
  type TextStyleName,
  type Theme,
} from '../theme/index.ts';
import metricsJson from './metrics.generated.json';

/**
 * Text width as the browser lays out one line, from the real advance widths of the bundled font
 * files (`metrics.generated.json`, built by `gen:font-metrics`). Used where a size must match
 * what is drawn exactly, such as deciding whether a line is cut off (`text_truncated`); size
 * hints keep the cheaper average (`approxTextWidth`). Pure and React-free.
 *
 * Kerning is not applied: Latin kerning pairs mostly tighten text, so a measured line is at most
 * slightly wider than the browser's, and a warning errs early rather than late.
 */

/**
 * One font file in font units: the code points it covers (inclusive ranges), the advance of most
 * of them (`advance`; every glyph of a monospace face) and `widths` for the rest.
 */
export type FaceMetrics = {
  unitsPerEm: number;
  /** `[from, to]` pairs. */
  ranges: number[][];
  advance: number;
  widths: Record<string, number>;
};

/** Font file path (under `public/`) → its metrics. */
export type FontMetricsTable = Record<string, FaceMetrics>;

const METRICS: FontMetricsTable = metricsJson;

/**
 * Width in px of `text` on one line in a text style: the case transform, each glyph's advance
 * from the first face of the style's stack that has it (the role, then its bundled fallbacks;
 * the role's average advance when none does), plus letter spacing after every character.
 */
export function textWidth(
  theme: Theme,
  style: TextStyleName,
  text: string,
  metrics: FontMetricsTable = METRICS,
): number {
  const s = theme.text[style];
  const shown = [...(s.uppercase ? text.toUpperCase() : text)];
  const faces = stackFaces(theme, style, metrics);
  const fallbackEm = theme.fonts[s.font].advanceEm;
  const em = shown.reduce((sum, ch) => sum + (glyphEm(faces, ch) ?? fallbackEm), 0);
  return em * s.size + s.letterSpacing * s.size * shown.length;
}

/** Metrics of the style's faces in stack order, each at the file closest to the style's weight. */
function stackFaces(theme: Theme, style: TextStyleName, metrics: FontMetricsTable): FaceMetrics[] {
  const { font, weight } = theme.text[style];
  const keys: BundledFontKey[] = [font, ...theme.fonts[font].bundledFallbacks];
  return keys.flatMap((key) => {
    const face = bundledFont(theme, key);
    if (!face) return [];
    const file = face.files.reduce((best, f) =>
      Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best,
    );
    const found = metrics[file.path];
    if (!found) throw new Error(`No font metrics for ${file.path}; run gen:font-metrics.`);
    return [found];
  });
}

/** Advance of one character in em from the first face that has it. */
function glyphEm(faces: readonly FaceMetrics[], ch: string): number | undefined {
  const codePoint = ch.codePointAt(0) ?? 0;
  const face = faces.find((f) => covers(f, codePoint));
  if (!face) return undefined;
  return (face.widths[String(codePoint)] ?? face.advance) / face.unitsPerEm;
}

function covers(face: FaceMetrics, codePoint: number): boolean {
  return face.ranges.some(([from = 0, to = -1]) => codePoint >= from && codePoint <= to);
}
