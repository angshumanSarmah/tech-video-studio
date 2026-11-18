import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `DevBeatPreview` is a stand-in until primitives exist. Once P1A.5 adds the primitive registry
 * (at `src/primitives/registry.ts`), no code outside `src/dev` may still render it.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const REGISTRY = join(SRC, 'primitives', 'registry.ts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'dev' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('temporary Dev layers', () => {
  it.skipIf(!existsSync(REGISTRY))(
    'DevBeatPreview is gone once the primitive registry exists (P1A.5)',
    () => {
      const users = sourceFiles(SRC)
        .filter((file) => readFileSync(file, 'utf8').includes('DevBeatPreview'))
        .map((file) => relative(SRC, file));
      expect(users, 'Replace DevBeatPreview with registry-driven primitives').toEqual([]);
    },
  );
});
