import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rendererRoot, rendererSourceHash } from './bundle.ts';

let dir: string;
let root: string;

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  root = join(dir, 'renderer');
  write(join(root, 'package.json'), '{}');
  write(join(root, 'src/scene/Beat.tsx'), 'scene');
  write(join(root, 'src/scene/Beat.test.tsx'), 'test');
  write(join(root, 'public/fonts/a.woff2'), 'font');
  write(join(dir, 'shared/package.json'), '{}');
  write(join(dir, 'shared/src/timing.ts'), 'timing');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('rendererSourceHash', () => {
  it('changes with renderer source, fonts and the shared package, not with tests', () => {
    const before = rendererSourceHash(root);
    expect(rendererSourceHash(root)).toBe(before);

    write(join(root, 'src/scene/Beat.test.tsx'), 'edited test');
    expect(rendererSourceHash(root)).toBe(before);

    for (const file of ['src/scene/Beat.tsx', 'public/fonts/a.woff2', '../shared/src/timing.ts']) {
      const hash = rendererSourceHash(root);
      write(join(root, file), `edited ${file}`);
      expect(rendererSourceHash(root)).not.toBe(hash);
    }
  });

  it('finds the real renderer package', () => {
    expect(rendererSourceHash(rendererRoot())).toMatch(/^[0-9a-f]{64}$/);
  });
});
