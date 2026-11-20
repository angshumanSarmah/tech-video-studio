import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodePng, encodePng, pngSize } from './png.ts';

describe('pngSize', () => {
  it('rejects bytes that are not a PNG', () => {
    expect(() => pngSize(new Uint8Array(32))).toThrow('Not a PNG file.');
  });
});

describe('encodePng / decodePng', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips RGBA through the bundled ffmpeg, alpha included', async () => {
    dir = mkdtempSync(join(tmpdir(), 'png-test-'));
    const size = { width: 3, height: 2 };
    const rgba = new Uint8Array([
      ...[255, 0, 0, 255],
      ...[0, 255, 0, 255],
      ...[0, 0, 255, 255],
      ...[10, 20, 30, 0],
      ...[200, 100, 50, 128],
      ...[255, 255, 255, 255],
    ]);
    const path = join(dir, 'out.png');
    await encodePng(rgba, size, path, join(dir, 'scratch.rgba'));
    expect(pngSize(readFileSync(path))).toEqual(size);
    const decoded = await decodePng(path, join(dir, 'scratch.rgba'));
    expect(decoded.size).toEqual(size);
    expect([...decoded.rgba]).toEqual([...rgba]);
  });
});
