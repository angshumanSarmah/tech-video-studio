import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveTiming, VIDEO_FORMATS } from '@explainer-studio/shared';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import {
  fixtureChannelHandle,
  fixtureSeries,
  layoutModesBoardSpec,
  withFormat,
} from '../fixtures/index.ts';
import { specLayout } from '../src/layout/spec-layout.ts';
import { DEFAULT_THEME_ID, getTheme } from '../src/theme/index.ts';
import { beatFrameSpans } from '../src/timing/frames.ts';

/**
 * Renders `docs/layouts/<mode>-<format>.png` for every layout mode in both formats, from the
 * layout fixture (`fixtures/layout-modes-board.json`): the last frame of each chain's last beat,
 * so every element has entered and a chain shows its final camera. Bundles once.
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(packageRoot, '../../docs/layouts');
const FPS = 30;

const serveUrl = await bundle({
  entryPoint: resolve(packageRoot, 'src/entry.ts'),
  rootDir: packageRoot,
  publicDir: resolve(packageRoot, 'public'),
});
mkdirSync(outDir, { recursive: true });
const theme = getTheme(DEFAULT_THEME_ID);
for (const format of VIDEO_FORMATS) {
  const spec = withFormat(layoutModesBoardSpec, format);
  const spans = beatFrameSpans(effectiveTiming(spec), FPS);
  const inputProps = {
    spec,
    series: fixtureSeries,
    audioSrc: null,
    channelHandle: fixtureChannelHandle,
    fps: FPS,
  };
  const composition = await selectComposition({ serveUrl, id: 'VideoFromSpec', inputProps });
  for (const chain of specLayout(spec, theme).chains) {
    const span = spans.find((s) => s.beatId === chain.beatIds.at(-1));
    if (!span) continue;
    const output = resolve(outDir, `${chain.board.mode}-${format}.png`);
    const frame = span.from + span.durationInFrames - 1;
    await renderStill({ serveUrl, composition, inputProps, output, frame, overwrite: true });
    console.log(`Wrote ${output}`);
  }
}
