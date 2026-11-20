/**
 * Pixel comparison for the visual regression test (pure: RGBA buffers in, numbers out).
 *
 * A pixel differs when any channel (alpha included) is off by more than `channelTolerance`; an
 * image matches when at most `maxDiffPixels` pixels differ. The channel tolerance absorbs
 * antialiasing and colour-rounding noise. The budget is a count, not a share of the image: one
 * changed glyph in a label moves only ~60 pixels of a 540×960 still (0.01%), so any ratio loose
 * enough to mean something would let it through.
 */

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export interface DiffOptions {
  /** Largest per-channel difference (0–255) that still counts as the same pixel. */
  readonly channelTolerance: number;
  /** Most differing pixels for the images to still match. */
  readonly maxDiffPixels: number;
}

export interface DiffResult {
  readonly ok: boolean;
  readonly diffPixels: number;
  readonly totalPixels: number;
  readonly ratio: number;
  /** One byte per pixel: 1 where the pixel differs. */
  readonly mask: Uint8Array;
}

/**
 * Repeated renders on one machine are byte-identical; the budget leaves room for a little
 * rasterising noise (a browser patch release) while a changed glyph (~60 pixels) still fails.
 */
export const DEFAULT_DIFF_OPTIONS: DiffOptions = { channelTolerance: 24, maxDiffPixels: 20 };

const CHANNELS = 4;

/** Compares two RGBA images of the same size. Throws when the buffers do not fit `size`. */
export function compareRgba(
  expected: Uint8Array,
  actual: Uint8Array,
  size: ImageSize,
  options: DiffOptions = DEFAULT_DIFF_OPTIONS,
): DiffResult {
  const totalPixels = size.width * size.height;
  assertLength(expected, totalPixels, 'expected');
  assertLength(actual, totalPixels, 'actual');
  const mask = new Uint8Array(totalPixels);
  let diffPixels = 0;
  for (let p = 0; p < totalPixels; p++) {
    if (pixelDiffers(expected, actual, p * CHANNELS, options.channelTolerance)) {
      mask[p] = 1;
      diffPixels++;
    }
  }
  const ratio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  return { ok: diffPixels <= options.maxDiffPixels, diffPixels, totalPixels, ratio, mask };
}

/**
 * A diff picture for a human: the expected image faded to 25% over white, with differing pixels
 * in solid red.
 */
export function diffImage(expected: Uint8Array, mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(mask.length * CHANNELS);
  for (let p = 0; p < mask.length; p++) {
    const i = p * CHANNELS;
    if (mask[p]) {
      out.set([255, 0, 0, 255], i);
    } else {
      for (let c = 0; c < 3; c++) out[i + c] = fade(expected[i + c] ?? 0);
      out[i + 3] = 255;
    }
  }
  return out;
}

export function describeDiff(result: DiffResult): string {
  const percent = (result.ratio * 100).toFixed(3);
  return `${result.diffPixels} of ${result.totalPixels} pixels differ (${percent}%)`;
}

function pixelDiffers(a: Uint8Array, b: Uint8Array, i: number, tolerance: number): boolean {
  for (let c = 0; c < CHANNELS; c++) {
    if (Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0)) > tolerance) return true;
  }
  return false;
}

function fade(value: number): number {
  return Math.round(255 - (255 - value) * 0.25);
}

function assertLength(buffer: Uint8Array, pixels: number, name: string): void {
  if (buffer.length !== pixels * CHANNELS) {
    throw new Error(
      `${name}: ${buffer.length} bytes, but the image needs ${pixels * CHANNELS} (RGBA).`,
    );
  }
}
