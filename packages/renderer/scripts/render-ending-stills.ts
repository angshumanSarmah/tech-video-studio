import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { goldenFixtures } from '../fixtures/index.ts';
import { DEFAULT_THEME_ID, listThemes } from '../src/theme/index.ts';

/**
 * Renders `docs/ending/<fixture>-<theme>.png` from the `EndingSheet` composition: each golden
 * fixture's ending card in both formats, at four moments. Themes are the ids given as arguments,
 * else the default theme (blueprint-dark is parked: `still:ending blueprint-dark` on demand).
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(packageRoot, '../../docs/ending');

const requested = process.argv.slice(2);
const known = new Set(listThemes().map((t) => t.id));
const unknown = requested.filter((id) => !known.has(id));
if (unknown.length > 0) {
  console.error(`Unknown theme ids: ${unknown.join(', ')}`);
  process.exit(1);
}
const themeIds = requested.length > 0 ? requested : [DEFAULT_THEME_ID];

const serveUrl = await bundle({
  entryPoint: resolve(packageRoot, 'src/entry.ts'),
  rootDir: packageRoot,
  publicDir: resolve(packageRoot, 'public'),
});
mkdirSync(outDir, { recursive: true });
for (const themeId of themeIds) {
  for (const { spec } of goldenFixtures) {
    const inputProps = { fixtureId: spec.meta.id, themeId };
    const composition = await selectComposition({ serveUrl, id: 'EndingSheet', inputProps });
    const output = resolve(outDir, `${spec.meta.id}-${themeId}.png`);
    await renderStill({ serveUrl, composition, inputProps, output, overwrite: true });
    console.log(`Wrote ${output}`);
  }
}
