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
 * what is drawn exactly, such as deciding whether a line is cut off (`text_truncated`), and by
 * every size hint (`approxTextWidth`). Pure and React-free.
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

export type MeasureOptions = {
  /** Override the style's case transform (e.g. a handle drawn with `textTransform: none`). */
  uppercase?: boolean;
  metrics?: FontMetricsTable;
};

/**
 * Width in px of `text` on one line in a text style: the case transform, each glyph's advance
 * from the first face of the style's stack that has it (the role, then its bundled fallbacks;
 * the role's average advance when none does), plus letter spacing after every character.
 */
export function textWidth(
  theme: Theme,
  style: TextStyleName,
  text: string,
  { uppercase, metrics = METRICS }: MeasureOptions = {},
): number {
  const s = theme.text[style];
  const shown = [...((uppercase ?? s.uppercase) ? text.toUpperCase() : text)];
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

export type Wrapped = {
  /** Lines a greedy wrap at spaces needs (like CSS `white-space: normal`). */
  lines: number;
  /** A single word is wider than the line, so it would be clipped whatever the line count. */
  overflows: boolean;
};

/**
 * How `text` wraps into lines of `width` px in a text style: greedy at spaces, measured with
 * `textWidth`. CSS may also break after a hyphen, so this never counts fewer lines than the
 * browser does.
 */
export function wrapText(
  theme: Theme,
  style: TextStyleName,
  text: string,
  width: number,
  options: MeasureOptions = {},
): Wrapped {
  const words = text.split(' ').filter((w) => w.length > 0);
  const fits = (line: string) => textWidth(theme, style, line, options) <= width + FIT_EPSILON_PX;
  let lines = words.length > 0 ? 1 : 0;
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && !fits(next)) {
      lines += 1;
      line = word;
    } else {
      line = next;
    }
  }
  return { lines, overflows: words.some((w) => !fits(w)) };
}

/** Sub-pixel slack for float noise when comparing a measured width with a room. */
export const FIT_EPSILON_PX = 0.5;

/** Whether one line of `text` fits in `room` px. */
export function fitsLine(
  theme: Theme,
  style: TextStyleName,
  text: string,
  room: number,
  options: MeasureOptions = {},
): boolean {
  return textWidth(theme, style, text, options) <= room + FIT_EPSILON_PX;
}

/**
 * Invented English text of everyday letters and spaces, whose average advance stands for a
 * typical label when a room is stated in characters.
 */
const SAMPLE_TEXT = 'Shared store refills one bucket per key while the gateway waits';

/**
 * About how many characters of everyday text fit in `room` px in a text style (its case
 * transform and letter spacing included): for messages and prompt hints, never for fit
 * decisions (`fitsLine` measures the real text).
 */
export function roomInChars(
  theme: Theme,
  style: TextStyleName,
  room: number,
  options: MeasureOptions = {},
): number {
  const average = textWidth(theme, style, SAMPLE_TEXT, options) / SAMPLE_TEXT.length;
  return Math.max(0, Math.floor(room / average));
}

/** "123 px (about 8 characters)": a room as `text_truncated` messages state it. */
export function describeRoom(
  theme: Theme,
  style: TextStyleName,
  room: number,
  options: MeasureOptions = {},
): string {
  return `${Math.round(room)} px (about ${roomInChars(theme, style, room, options)} characters)`;
}
