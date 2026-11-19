import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { fixtureSeries } from '../fixtures/index.ts';
import { listPrimitives } from '../src/primitives/registry.ts';
import { listThemes } from '../src/theme/index.ts';

/**
 * Renders theme comparison stills for every registered theme (or the theme ids given as
 * arguments):
 *   docs/themes/<theme>.png                          swatch board
 *   docs/themes/compare/<primitive>-<theme>.png      one primitive sheet per primitive
 *   docs/themes/compare/rate-limiter-<theme>.png     middle frame of the rate-limiter fixture
 * The rate-limiter frame uses each theme's fallback accent (no series accent), so the series
 * label shows in the theme's own accent.
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const themesDir = resolve(packageRoot, '../../docs/themes');
const compareDir = resolve(themesDir, 'compare');

type Serve = { serveUrl: string };

function requestedThemeIds(): string[] {
  const known = listThemes().map((t) => t.id);
  const requested = process.argv.slice(2);
  const unknown = requested.filter((id) => !known.includes(id));
  if (unknown.length > 0) throw new Error(`Unknown theme ids: ${unknown.join(', ')}`);
  return requested.length > 0 ? requested : known;
}

async function still(
  { serveUrl }: Serve,
  id: string,
  inputProps: Record<string, unknown>,
  output: string,
  frame?: (durationInFrames: number) => number,
): Promise<void> {
  const composition = await selectComposition({ serveUrl, id, inputProps });
  const at = frame ? frame(composition.durationInFrames) : 0;
  await renderStill({ serveUrl, composition, inputProps, output, frame: at, overwrite: true });
  console.log(`Wrote ${output}`);
}

async function renderTheme(serve: Serve, themeId: string): Promise<void> {
  await still(serve, 'ThemeSwatchBoard', { themeId }, resolve(themesDir, `${themeId}.png`));
  for (const { id: primitiveId } of listPrimitives()) {
    const output = resolve(compareDir, `${primitiveId}-${themeId}.png`);
    await still(serve, 'PrimitiveSheet', { primitiveId, themeId }, output);
  }
  const series = { ...fixtureSeries, accentColour: null };
  const output = resolve(compareDir, `rate-limiter-${themeId}.png`);
  await still(serve, 'VideoFromSpec', { themeId, series }, output, (d) => Math.floor(d / 2));
}

async function main(): Promise<void> {
  const themeIds = requestedThemeIds();
  const serveUrl = await bundle({
    entryPoint: resolve(packageRoot, 'src/entry.ts'),
    rootDir: packageRoot,
    publicDir: resolve(packageRoot, 'public'),
  });
  mkdirSync(compareDir, { recursive: true });
  for (const themeId of themeIds) await renderTheme({ serveUrl }, themeId);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
