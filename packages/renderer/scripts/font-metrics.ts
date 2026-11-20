import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import type { FaceMetrics, FontMetricsTable } from '../src/fonts/measure-text.ts';
import { bundledFonts, listThemes } from '../src/theme/index.ts';

/**
 * Builds `src/fonts/metrics.generated.json`: the advance width of every glyph in every bundled
 * font file, so text can be measured the way the browser lays it out (`measure-text.ts`) without
 * loading fonts at runtime. Regenerate after `fonts:subset` or a theme font change
 * (`gen:font-metrics`); a test fails when the file is stale.
 */

export const FONT_METRICS_PATH = fileURLToPath(
  new URL('../src/fonts/metrics.generated.json', import.meta.url),
);

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

export function buildFontMetrics(): string {
  const table: FontMetricsTable = Object.fromEntries(
    bundledFontPaths().map((path) => [path, faceMetrics(PUBLIC_DIR + path)]),
  );
  const lines = Object.entries(table).map(
    ([path, face]) => ` ${JSON.stringify(path)}: ${JSON.stringify(face)}`,
  );
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** Every font file any theme bundles, sorted. */
function bundledFontPaths(): string[] {
  const paths = listThemes().flatMap((theme) =>
    bundledFonts(theme).flatMap((face) => face.files.map((file) => file.path)),
  );
  return [...new Set(paths)].sort();
}

/**
 * Advances in font units: the covered code points as ranges, the most common advance as
 * `advance` (every glyph of a monospace face), and in `widths` each code point that differs.
 */
function faceMetrics(file: string): FaceMetrics {
  const font = fontkit.openSync(file);
  if (!('characterSet' in font)) throw new Error(`${file} is a font collection`);
  const advances = new Map<number, number>();
  for (const codePoint of [...font.characterSet].sort((a, b) => a - b)) {
    advances.set(codePoint, font.glyphForCodePoint(codePoint).advanceWidth);
  }
  const advance = mostCommon([...advances.values()]);
  const widths: Record<string, number> = {};
  for (const [codePoint, width] of advances) {
    if (width !== advance) widths[String(codePoint)] = width;
  }
  return { unitsPerEm: font.unitsPerEm, ranges: toRanges([...advances.keys()]), advance, widths };
}

/** Sorted code points as inclusive [from, to] runs. */
export function toRanges(sorted: readonly number[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const cp of sorted) {
    const last = ranges.at(-1);
    if (last && cp === last[1] + 1) last[1] = cp;
    else ranges.push([cp, cp]);
  }
  return ranges;
}

function mostCommon(values: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? 0;
  for (const [value, count] of counts) {
    if (count > (counts.get(best) ?? 0) || (count === counts.get(best) && value < best)) {
      best = value;
    }
  }
  return best;
}
