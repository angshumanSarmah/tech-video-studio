import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VIDEO_FORMATS,
  type RenderableVideoSpec,
  type VideoFormat,
} from '@explainer-studio/shared';
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
import { patternFormats } from '../src/patterns/types.ts';
import { settledPatternFrame } from '../src/stills/pattern-sheet.ts';

/**
 * Renders `docs/patterns/<id>-layout-<format>.png` for every registered pattern (or the ids given
 * as arguments), in both formats: the pattern's beat on its pattern board through the real layout
 * engine (`VideoFromSpec` → `BeatScene`: placement, camera, routing, HUD), at its settled moment
 * (`settledPatternFrame`). The per-anchor sheets (`still:patterns`) stay the record of timing.
 *
 * A pattern whose board params do not suit a format (`formatRule`) is drawn in that format with
 * its lighter variant from `FORMAT_VARIANTS` when there is one (checked to suit the format), so the
 * still shows the pattern as it would be used there; otherwise as is, with a note.
 */

type Params = Record<string, unknown>;

/** Lighter params per pattern and format, for formats the board's params do not suit. */
const FORMAT_VARIANTS: Record<string, Partial<Record<VideoFormat, (p: Params) => Params>>> = {
  split_brain: { card: ({ lease: _lease, ...rest }) => rest },
};

/** The spec with the pattern's params swapped for its variant in this format, if it needs one. */
function forFormat(spec: RenderableVideoSpec, patternId: string, format: VideoFormat) {
  const definition = DEFAULT_REGISTRIES.patterns.get(patternId);
  const variant = FORMAT_VARIANTS[patternId]?.[format];
  const scenes = spec.scenes.map((scene) => ({
    ...scene,
    patterns: scene.patterns.map((instance) => {
      if (instance.pattern !== patternId || !definition) return instance;
      const parsed = definition.paramsSchema.parse(instance.params);
      if (patternFormats(definition, parsed).includes(format)) return instance;
      if (!variant) {
        console.warn(`${patternId} does not suit ${format}; drawn as is.`);
        return instance;
      }
      const params = variant(instance.params);
      if (!patternFormats(definition, definition.paramsSchema.parse(params)).includes(format)) {
        throw new Error(`The ${format} variant of ${patternId} does not suit ${format}.`);
      }
      return { ...instance, params };
    }),
  }));
  return { ...spec, scenes };
}

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
    for (const patternId of ids) {
      const spec = forFormat(withFormat(board, format), patternId, format);
      const settled = settledPatternFrame(spec, patternId, FPS, DEFAULT_REGISTRIES);
      if (!settled) continue;
      const inputProps = {
        spec,
        series: fixtureSeries,
        audioSrc: null,
        channelHandle: fixtureChannelHandle,
        fps: FPS,
      };
      const composition = await selectComposition({ serveUrl, id: 'VideoFromSpec', inputProps });
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
