import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `src/dev` holds temporary stand-ins. Replaced ones stay gone: `DevBeatPreview` (P1A.5) and
 * `DevSubtitles` (P1B.3, by `src/subtitles/`).
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));

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

  it('DevSubtitles is gone (replaced by the subtitle layer in P1B.3)', () => {
    expect(existsSync(join(SRC, 'dev', 'DevSubtitles.tsx'))).toBe(false);
    expect(usersOf('DevSubtitles')).toEqual([]);
  });
});
