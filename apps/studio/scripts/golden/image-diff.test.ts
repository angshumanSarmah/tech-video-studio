import { describe, expect, it } from 'vitest';
import { compareRgba, describeDiff, diffImage, type DiffOptions } from './image-diff.ts';

const SIZE = { width: 10, height: 10 };
const OPTIONS: DiffOptions = { channelTolerance: 10, maxDiffPixels: 2 };

function solid(rgba: [number, number, number, number], pixels = 100): Uint8Array {
  const out = new Uint8Array(pixels * 4);
  for (let p = 0; p < pixels; p++) out.set(rgba, p * 4);
  return out;
}

function withPixels(base: Uint8Array, pixels: number[], rgba: [number, number, number, number]) {
  const out = base.slice();
  for (const p of pixels) out.set(rgba, p * 4);
  return out;
}

describe('compareRgba', () => {
  const white = solid([255, 255, 255, 255]);

  it('matches identical images', () => {
    const result = compareRgba(white, white.slice(), SIZE, OPTIONS);
    expect(result).toMatchObject({ ok: true, diffPixels: 0, ratio: 0 });
  });

  it('ignores channel differences within the tolerance', () => {
    const near = solid([245, 250, 255, 255]);
    expect(compareRgba(white, near, SIZE, OPTIONS).diffPixels).toBe(0);
  });

  it('counts a pixel when any channel, alpha included, is past the tolerance', () => {
    const changed = withPixels(white, [0], [255, 255, 255, 200]);
    expect(compareRgba(white, changed, SIZE, OPTIONS).diffPixels).toBe(1);
  });

  it('passes at the pixel budget and fails past it', () => {
    const two = withPixels(white, [3, 40], [0, 0, 0, 255]);
    expect(compareRgba(white, two, SIZE, OPTIONS)).toMatchObject({ ok: true, ratio: 0.02 });
    const three = withPixels(white, [3, 40, 99], [0, 0, 0, 255]);
    const result = compareRgba(white, three, SIZE, OPTIONS);
    expect(result).toMatchObject({ ok: false, diffPixels: 3 });
    expect([...result.mask.keys()].filter((p) => result.mask[p])).toEqual([3, 40, 99]);
    expect(describeDiff(result)).toBe('3 of 100 pixels differ (3.000%)');
  });

  it('throws when a buffer does not fit the size', () => {
    expect(() => compareRgba(white, solid([0, 0, 0, 255], 99), SIZE, OPTIONS)).toThrow(/actual/);
  });
});

describe('diffImage', () => {
  it('marks differing pixels red over the faded expected image', () => {
    const expected = solid([0, 0, 0, 255], 2);
    const out = diffImage(expected, new Uint8Array([1, 0]));
    expect([...out]).toEqual([255, 0, 0, 255, 191, 191, 191, 255]);
  });
});
