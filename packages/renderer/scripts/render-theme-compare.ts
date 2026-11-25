import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { fixtureSeries, rateLimiterSpec, withFormat } from '../fixtures/index.ts';
import { listPrimitives } from '../src/primitives/registry.ts';
import { listThemes } from '../src/theme/index.ts';

/**
 * Renders theme comparison stills for every registered theme (or the theme ids given as
 * arguments). `--only <targets>` (comma-separated: `swatch`, `rate-limiter`, `rate-limiter-card`,
 * `rate-limiter-part` or primitive ids)
 * limits what is rendered; without it, everything is:
 *   docs/themes/<theme>.png                          swatch board
 *   docs/themes/compare/<primitive>-<theme>.png      one primitive sheet per primitive
 *   docs/themes/compare/rate-limiter-<theme>.png     middle frame of the rate-limiter fixture
 *   docs/themes/compare/rate-limiter-card-<theme>.png    the same frame in the card format
 *   docs/themes/compare/rate-limiter-part-<theme>.png    the same frame as part 2 of 2 (the
 *                                                        title block's PART 2/2 cell)
 * The rate-limiter frame uses the fixture series accent, adapted to each theme (`seriesAccent`).
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const themesDir = resolve(packageRoot, '../../docs/themes');
const compareDir = resolve(themesDir, 'compare');

type Serve = { serveUrl: string };

const SWATCH = 'swatch';
const RATE_LIMITER = 'rate-limiter';
const RATE_LIMITER_CARD = 'rate-limiter-card';
const RATE_LIMITER_PART = 'rate-limiter-part';

type Plan = { themeIds: string[]; targets: Set<string> };

function pick(requested: string[], known: string[], what: string): string[] {
  const unknown = requested.filter((id) => !known.includes(id));
  if (unknown.length > 0) throw new Error(`Unknown ${what}: ${unknown.join(', ')}`);
  return requested.length > 0 ? requested : known;
}

/** Theme ids from the positional arguments, targets from `--only`; empty means all. */
function parseArgs(argv: string[]): Plan {
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt >= 0 ? (argv[onlyAt + 1] ?? '').split(',').filter(Boolean) : [];
  const positional = onlyAt >= 0 ? argv.filter((_, i) => i !== onlyAt && i !== onlyAt + 1) : argv;
  const allTargets = [
    SWATCH,
    ...listPrimitives().map((p) => p.id),
    RATE_LIMITER,
    RATE_LIMITER_CARD,
    RATE_LIMITER_PART,
  ];
  return {
    themeIds: pick(
      positional,
      listThemes().map((t) => t.id),
      'theme ids',
    ),
    targets: new Set(pick(only, allTargets, 'targets')),
  };
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

async function renderTheme(serve: Serve, themeId: string, targets: Set<string>): Promise<void> {
  if (targets.has(SWATCH)) {
    await still(serve, 'ThemeSwatchBoard', { themeId }, resolve(themesDir, `${themeId}.png`));
  }
  for (const { id: primitiveId } of listPrimitives()) {
    if (!targets.has(primitiveId)) continue;
    const output = resolve(compareDir, `${primitiveId}-${themeId}.png`);
    await still(serve, 'PrimitiveSheet', { primitiveId, themeId }, output);
  }
  const props = { themeId, series: fixtureSeries };
  const middle = (d: number) => Math.floor(d / 2);
  if (targets.has(RATE_LIMITER)) {
    const output = resolve(compareDir, `${RATE_LIMITER}-${themeId}.png`);
    await still(serve, 'VideoFromSpec', props, output, middle);
  }
  if (targets.has(RATE_LIMITER_CARD)) {
    const output = resolve(compareDir, `${RATE_LIMITER_CARD}-${themeId}.png`);
    const card = { ...props, spec: withFormat(rateLimiterSpec, 'card') };
    await still(serve, 'VideoFromSpec', card, output, middle);
  }
  if (targets.has(RATE_LIMITER_PART)) {
    const output = resolve(compareDir, `${RATE_LIMITER_PART}-${themeId}.png`);
    const meta = { ...rateLimiterSpec.meta, part: { index: 2, count: 2 } };
    const part = { ...props, spec: { ...rateLimiterSpec, meta } };
    await still(serve, 'VideoFromSpec', part, output, middle);
  }
}

async function main(): Promise<void> {
  const { themeIds, targets } = parseArgs(process.argv.slice(2));
  const serveUrl = await bundle({
    entryPoint: resolve(packageRoot, 'src/entry.ts'),
    rootDir: packageRoot,
    publicDir: resolve(packageRoot, 'public'),
  });
  mkdirSync(compareDir, { recursive: true });
  for (const themeId of themeIds) await renderTheme({ serveUrl }, themeId, targets);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
