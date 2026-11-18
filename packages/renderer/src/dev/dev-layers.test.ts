import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `src/dev` holds temporary stand-ins. `DevSubtitles` goes once P1B.3 adds the subtitle layer (at
 * `src/subtitles/`); from then on no code outside `src/dev` may still render it.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const SUBTITLES = join(SRC, 'subtitles');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'dev' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function usersOf(name: string): string[] {
  return sourceFiles(SRC)
    .filter((file) => readFileSync(file, 'utf8').includes(name))
    .map((file) => relative(SRC, file));
}

describe('temporary Dev layers', () => {
  it('DevBeatPreview is gone (replaced by registry-driven primitives in P1A.5)', () => {
    expect(existsSync(join(SRC, 'dev', 'DevBeatPreview.tsx'))).toBe(false);
    expect(usersOf('DevBeatPreview')).toEqual([]);
  });

  it.skipIf(!existsSync(SUBTITLES))(
    'DevSubtitles is gone once the subtitle layer exists (P1B.3)',
    () => {
      expect(usersOf('DevSubtitles'), 'Replace DevSubtitles with the subtitle layer').toEqual([]);
    },
  );
});
