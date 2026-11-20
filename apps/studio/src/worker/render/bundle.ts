import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Remotion bundle of `@explainer-studio/renderer`, built once per worker process on the first
 * render and reused by every later job (webpack takes seconds; a render job should not). A failed
 * build is not cached, so the next job retries.
 */

export type RendererBundle = {
  /** Remotion `serveUrl`: the bundle directory. */
  serveUrl: string;
  /** Hash of everything the bundle is built from (see `sourceHash`); part of draft cache keys. */
  sourceHash: string;
};

let pending: Promise<RendererBundle> | undefined;

export function getRendererBundle(): Promise<RendererBundle> {
  pending ??= buildBundle().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

async function buildBundle(): Promise<RendererBundle> {
  const { bundle } = await import('@remotion/bundler');
  const root = rendererRoot();
  const sourceHash = rendererSourceHash();
  const serveUrl = await bundle({
    entryPoint: join(root, 'src/entry.ts'),
    rootDir: root,
    publicDir: join(root, 'public'),
  });
  return { serveUrl, sourceHash };
}

/** Directory of the `@explainer-studio/renderer` package. */
export function rendererRoot(): string {
  return dirname(fileURLToPath(import.meta.resolve('@explainer-studio/renderer/package.json')));
}

/**
 * Hash of the files that decide what a render draws: the renderer's source and fonts, the shared
 * package's source (validation, timing) and both manifests (dependency versions). Tests and
 * gitignored calibration screenshots are left out. A change to any of them makes every cached
 * draft clip stale.
 */
export function rendererSourceHash(root = rendererRoot()): string {
  const shared = resolve(root, '../shared');
  const files = [
    ...sourceFiles(join(root, 'src')),
    ...sourceFiles(join(root, 'public/fonts')),
    ...sourceFiles(join(shared, 'src')),
    join(root, 'package.json'),
    join(shared, 'package.json'),
  ];
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(root, file)).update('\0').update(readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}

const TEST_FILE = /\.test\.tsx?$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !TEST_FILE.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}
