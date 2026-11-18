import type { ScreenshotCrop } from '../src/stills/SafeAreaCalibration.tsx';
import { PLATFORMS, type Platform } from '../src/theme/index.ts';

export const USAGE = `Usage: calibrate:safe-area <${PLATFORMS.join('|')}>`;

export function parsePlatform(arg: string | undefined): Platform {
  const platform = PLATFORMS.find((p) => p === arg);
  if (!platform) throw new Error(`${USAGE}\nGot: ${arg ?? '(nothing)'}`);
  return platform;
}

/** Screenshot under `public/` and the check image under the repo's docs, per platform. */
export function calibrationPaths(platform: Platform): { screenshot: string; output: string } {
  return {
    screenshot: `calibration/${platform}.png`,
    output: `../../docs/safe-area/${platform}-check.png`,
  };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const isPng = PNG_SIGNATURE.every((b, i) => bytes[i] === b);
  if (!isPng || bytes.length < 24) throw new Error('Not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

type Size = { width: number; height: number };

/**
 * The largest centred crop of `source` (in source pixels) with the canvas aspect: a taller
 * screenshot keeps its full width, a wider one its full height.
 */
export function centreCrop(source: Size, canvas: Size): ScreenshotCrop {
  const aspect = canvas.width / canvas.height;
  const crop = { sourceWidth: source.width, sourceHeight: source.height };
  if (source.width / source.height > aspect) {
    const width = Math.min(source.width, Math.round(source.height * aspect));
    return {
      ...crop,
      x: Math.floor((source.width - width) / 2),
      y: 0,
      width,
      height: source.height,
    };
  }
  const height = Math.min(source.height, Math.round(source.width / aspect));
  return {
    ...crop,
    x: 0,
    y: Math.floor((source.height - height) / 2),
    width: source.width,
    height,
  };
}

/** One line describing the crop, for the script's output. */
export function describeCrop(crop: ScreenshotCrop): string {
  const source = `${crop.sourceWidth}x${crop.sourceHeight}`;
  if (crop.width === crop.sourceWidth && crop.height === crop.sourceHeight) {
    return `Screenshot ${source} is already 9:16; no crop.`;
  }
  return `Cropped screenshot ${source} to ${crop.width}x${crop.height} at (${crop.x},${crop.y}).`;
}

/** Arguments for `remotion still` that render the calibration overlay over the cropped screenshot. */
export function remotionStillArgs(platform: Platform, crop: ScreenshotCrop): string[] {
  const { screenshot, output } = calibrationPaths(platform);
  const props = JSON.stringify({ platform, screenshot, crop });
  return ['still', 'src/entry.ts', 'SafeAreaCalibration', output, `--props=${props}`];
}
