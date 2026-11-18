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

/** A warning when the screenshot is not the canvas aspect (it is stretched to fit), else null. */
export function aspectWarning(
  size: { width: number; height: number },
  canvas: { width: number; height: number },
): string | null {
  const ratio = size.width / size.height / (canvas.width / canvas.height);
  if (Math.abs(ratio - 1) <= 0.01) return null;
  return (
    `Screenshot is ${size.width}x${size.height}, not ${canvas.width}:${canvas.height}; it will be ` +
    'stretched. Crop it to the video frame first.'
  );
}

/** Arguments for `remotion still` that render the calibration overlay over the screenshot. */
export function remotionStillArgs(platform: Platform): string[] {
  const { screenshot, output } = calibrationPaths(platform);
  const props = JSON.stringify({ platform, screenshot });
  return ['still', 'src/entry.ts', 'SafeAreaCalibration', output, `--props=${props}`];
}
