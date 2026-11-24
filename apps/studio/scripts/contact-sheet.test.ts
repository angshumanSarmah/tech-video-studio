import { describe, expect, it } from 'vitest';
import { contactSheet, type RgbaImage } from './contact-sheet.ts';

/** A solid image of one grey value. */
function solid(width: number, height: number, value: number): RgbaImage {
  return {
    size: { width, height },
    rgba: new Uint8Array(width * height * 4).fill(value),
  };
}

const pixel = (sheet: RgbaImage, x: number, y: number) => [
  ...sheet.rgba.subarray((y * sheet.size.width + x) * 4, (y * sheet.size.width + x) * 4 + 4),
];

describe('contactSheet', () => {
  const background = [0, 0, 0, 255] as const;

  it('tiles images in rows of `columns`, a gap apart and around the edge', () => {
    const images = [solid(2, 3, 10), solid(2, 3, 20), solid(2, 3, 30)];
    const sheet = contactSheet(images, { columns: 2, gap: 1, background });
    expect(sheet.size).toEqual({ width: 2 * 2 + 3, height: 2 * 3 + 3 });
    expect(pixel(sheet, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(sheet, 1, 1)).toEqual([10, 10, 10, 10]);
    expect(pixel(sheet, 4, 3)).toEqual([20, 20, 20, 20]);
    expect(pixel(sheet, 1, 5)).toEqual([30, 30, 30, 30]);
    // The last row's empty cell keeps the background.
    expect(pixel(sheet, 4, 5)).toEqual([0, 0, 0, 255]);
  });

  it('never makes more columns than images, and sizes cells to the largest image', () => {
    const sheet = contactSheet([solid(2, 2, 10), solid(3, 1, 20)], {
      columns: 4,
      gap: 0,
      background,
    });
    expect(sheet.size).toEqual({ width: 6, height: 2 });
    expect(pixel(sheet, 3, 0)).toEqual([20, 20, 20, 20]);
    expect(pixel(sheet, 3, 1)).toEqual([0, 0, 0, 255]);
  });
});
