import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTheme } from '../src/theme/index.ts';
import {
  calibrationPaths,
  centreCrop,
  describeCrop,
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
      `Missing ${screenshotPath}.\nSave a ${platform} screenshot there (the folder is ` +
        'gitignored). A non-9:16 screenshot is centre-cropped to 9:16.',
    );
    return 1;
  }
  const crop = centreCrop(pngSize(readFileSync(screenshotPath)), getTheme().canvas);
  console.log(describeCrop(crop));
  mkdirSync(dirname(join(root, output)), { recursive: true });
  const bin = join(root, 'node_modules', '.bin', 'remotion');
  const result = spawnSync(bin, remotionStillArgs(platform, crop), { cwd: root, stdio: 'inherit' });
  return result.status ?? 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
