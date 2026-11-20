import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { runFfmpeg } from '#worker/render/ffmpeg.ts';
import type { ImageSize } from './image-diff.ts';

/**
 * PNG in and out through Remotion's bundled ffmpeg (no image library needed). Paths must be
 * absolute (see `ffmpeg.ts`). The bundled build is trimmed: it has no `rawvideo` muxer or
 * demuxer, so raw frames go through the `image2` container with the `rawvideo` codec.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR chunk (always the first chunk). */
export function pngSize(bytes: Uint8Array): ImageSize {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a PNG file.');
  }
  if (buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error('PNG without an IHDR chunk.');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Decodes a PNG to raw RGBA (one byte per channel), using `scratch` for the raw file. */
export async function decodePng(
  path: string,
  scratch: string,
): Promise<{ size: ImageSize; rgba: Uint8Array }> {
  const size = pngSize(readFileSync(path));
  await runFfmpeg([
    ...['-y', '-v', 'error', '-i', path],
    ...['-f', 'image2', '-c:v', 'rawvideo', '-pix_fmt', 'rgba', '-frames:v', '1', '-update', '1'],
    scratch,
  ]);
  try {
    return { size, rgba: new Uint8Array(readFileSync(scratch)) };
  } finally {
    rmSync(scratch, { force: true });
  }
}

/** Encodes raw RGBA as a PNG at `path`, using `scratch` for the raw file. */
export async function encodePng(
  rgba: Uint8Array,
  size: ImageSize,
  path: string,
  scratch: string,
): Promise<void> {
  writeFileSync(scratch, rgba);
  try {
    await runFfmpeg([
      ...['-y', '-v', 'error', '-f', 'image2', '-c:v', 'rawvideo', '-pixel_format', 'rgba'],
      ...['-video_size', `${size.width}x${size.height}`, '-i', scratch],
      ...['-frames:v', '1', path],
    ]);
  } finally {
    rmSync(scratch, { force: true });
  }
}
