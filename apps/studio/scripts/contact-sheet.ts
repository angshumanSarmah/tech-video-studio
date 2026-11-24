import type { ImageSize } from './golden/image-diff.ts';

/**
 * A contact sheet: images tiled left to right, top to bottom, `columns` per row, `gap` px apart
 * and around the edge, on a solid background. Each image sits at the top-left of a cell as large
 * as the largest image. Pure (raw RGBA in and out; `png.ts` reads and writes the files).
 */

export interface RgbaImage {
  readonly size: ImageSize;
  readonly rgba: Uint8Array;
}

export interface SheetOptions {
  readonly columns: number;
  readonly gap: number;
  readonly background: readonly [number, number, number, number];
}

export function contactSheet(images: readonly RgbaImage[], options: SheetOptions): RgbaImage {
  const cell = cellSize(images);
  const columns = Math.max(1, Math.min(options.columns, images.length));
  const rows = Math.ceil(images.length / columns);
  const size = {
    width: columns * cell.width + (columns + 1) * options.gap,
    height: rows * cell.height + (rows + 1) * options.gap,
  };
  const sheet = filled(size, options.background);
  images.forEach((image, i) => {
    const x = options.gap + (i % columns) * (cell.width + options.gap);
    const y = options.gap + Math.floor(i / columns) * (cell.height + options.gap);
    blit(sheet, size, image, x, y);
  });
  return { size, rgba: sheet };
}

function cellSize(images: readonly RgbaImage[]): ImageSize {
  return {
    width: Math.max(0, ...images.map((i) => i.size.width)),
    height: Math.max(0, ...images.map((i) => i.size.height)),
  };
}

function filled(size: ImageSize, colour: SheetOptions['background']): Uint8Array {
  const rgba = new Uint8Array(size.width * size.height * 4);
  for (let p = 0; p < rgba.length; p += 4) rgba.set(colour, p);
  return rgba;
}

function blit(sheet: Uint8Array, size: ImageSize, image: RgbaImage, x: number, y: number): void {
  const rowBytes = image.size.width * 4;
  for (let row = 0; row < image.size.height; row++) {
    const from = row * rowBytes;
    sheet.set(image.rgba.subarray(from, from + rowBytes), ((y + row) * size.width + x) * 4);
  }
}
