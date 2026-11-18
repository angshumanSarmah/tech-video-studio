import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTheme } from '../src/theme/index.ts';
import {
  aspectWarning,
  calibrationPaths,
  parsePlatform,
  pngSize,
  remotionStillArgs,
} from './calibration.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

function main(): number {
  const platform = parsePlatform(process.argv[2]);
  const { screenshot, output } = calibrationPaths(platform);
  const screenshotPath = join(root, 'public', screenshot);
  if (!existsSync(screenshotPath)) {
    console.error(
      `Missing ${screenshotPath}.\nSave a ${platform} screenshot there, cropped to the 9:16 ` +
        'video frame (the folder is gitignored).',
    );
    return 1;
  }
  const warning = aspectWarning(pngSize(readFileSync(screenshotPath)), getTheme().canvas);
  if (warning) console.warn(`Warning: ${warning}`);
  mkdirSync(dirname(join(root, output)), { recursive: true });
  const bin = join(root, 'node_modules', '.bin', 'remotion');
  const result = spawnSync(bin, remotionStillArgs(platform), { cwd: root, stdio: 'inherit' });
  return result.status ?? 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
