import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';
import { SUBSET_CODE_POINTS } from '../src/fonts/glyphs.ts';
import { FONT_SOURCES, type FontSource } from './font-sources.ts';

/**
 * Rebuilds every bundled font file from its pinned source:
 *   pnpm --filter @explainer-studio/renderer fonts:subset
 * Sources are cached (by checksum) under node_modules/.cache/font-sources.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = join(root, 'node_modules', '.cache', 'font-sources');

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

async function fetchSource(source: FontSource): Promise<Buffer> {
  const cached = join(cacheDir, `${source.sha256}.ttf`);
  if (existsSync(cached)) return readFileSync(cached);
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== source.sha256) {
    throw new Error(`${source.url}: expected sha256 ${source.sha256}, got ${actual}`);
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, data);
  return data;
}

async function buildOne(source: FontSource, text: string): Promise<void> {
  const subset = await subsetFont(await fetchSource(source), text, {
    targetFormat: 'woff2',
    ...(source.axes ? { variationAxes: source.axes } : {}),
  });
  const out = join(root, 'public', source.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, subset);
  console.log(`${source.out}  ${(subset.length / 1024).toFixed(1)} KiB`);
}

async function main(): Promise<void> {
  const text = String.fromCodePoint(...SUBSET_CODE_POINTS);
  for (const source of FONT_SOURCES) await buildOne(source, text);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
