import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { listPrimitives } from '../src/primitives/registry.ts';

/**
 * Renders `docs/primitives/<id>.png` for every registered primitive (or the ids given as
 * arguments) from the `PrimitiveSheet` still. Bundles once, then renders each sheet.
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(packageRoot, '../../docs/primitives');

const requested = process.argv.slice(2);
const known = new Set(listPrimitives().map((p) => p.id));
const unknown = requested.filter((id) => !known.has(id));
if (unknown.length > 0) {
  console.error(`Unknown primitive ids: ${unknown.join(', ')}`);
  process.exit(1);
}
const ids = requested.length > 0 ? requested : [...known];

const serveUrl = await bundle({
  entryPoint: resolve(packageRoot, 'src/entry.ts'),
  rootDir: packageRoot,
  publicDir: resolve(packageRoot, 'public'),
});
mkdirSync(outDir, { recursive: true });
for (const primitiveId of ids) {
  const inputProps = { primitiveId };
  const composition = await selectComposition({ serveUrl, id: 'PrimitiveSheet', inputProps });
  const output = resolve(outDir, `${primitiveId}.png`);
  await renderStill({ serveUrl, composition, inputProps, output, overwrite: true });
  console.log(`Wrote ${output}`);
}
