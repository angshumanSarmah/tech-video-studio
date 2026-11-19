import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIDEO_FORMATS } from '@explainer-studio/shared';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import {
  fixtureChannelHandle,
  fixtureSeries,
  patternBoardSpecs,
  withFormat,
} from '../fixtures/index.ts';
import { DEFAULT_REGISTRIES } from '../src/catalog/registries.ts';
import { listPatterns } from '../src/patterns/registry.ts';
import { settledPatternFrame } from '../src/stills/pattern-sheet.ts';

/**
 * Renders `docs/patterns/<id>-layout-<format>.png` for every registered pattern (or the ids given
 * as arguments), in both formats: the pattern's beat on its pattern board through the real layout
 * engine (`VideoFromSpec` → `BeatScene`: placement, camera, routing, HUD), at its settled moment
 * (`settledPatternFrame`). The per-anchor sheets (`still:patterns`) stay the record of timing.
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(packageRoot, '../../docs/patterns');
const FPS = 30;

const requested = process.argv.slice(2);
const known = new Set(listPatterns().map((p) => p.id));
const unknown = requested.filter((id) => !known.has(id));
if (unknown.length > 0) {
  console.error(`Unknown pattern ids: ${unknown.join(', ')}`);
  process.exit(1);
}
const ids = requested.length > 0 ? requested : [...known];

const serveUrl = await bundle({
  entryPoint: resolve(packageRoot, 'src/entry.ts'),
  rootDir: packageRoot,
  publicDir: resolve(packageRoot, 'public'),
});
mkdirSync(outDir, { recursive: true });
for (const format of VIDEO_FORMATS) {
  for (const board of patternBoardSpecs) {
    const spec = withFormat(board, format);
    const inputProps = {
      spec,
      series: fixtureSeries,
      audioSrc: null,
      channelHandle: fixtureChannelHandle,
      fps: FPS,
    };
    const composition = await selectComposition({ serveUrl, id: 'VideoFromSpec', inputProps });
    for (const patternId of ids) {
      const settled = settledPatternFrame(spec, patternId, FPS, DEFAULT_REGISTRIES);
      if (!settled) continue;
      const output = resolve(outDir, `${patternId}-layout-${format}.png`);
      await renderStill({
        serveUrl,
        composition,
        inputProps,
        output,
        frame: settled.frame,
        overwrite: true,
      });
      console.log(`Wrote ${output}`);
    }
  }
}
