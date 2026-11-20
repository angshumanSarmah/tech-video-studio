import { createHash } from 'node:crypto';

/**
 * Identity of the narration under one beat clip, for its cache key: a hash of the PCM bytes in
 * the clip's time range (plus the format), so re-synthesising another beat does not invalidate
 * this one. A file that is not a plain PCM WAV falls back to a hash of the whole file (always
 * correct, only less reusable). Pure.
 */
export function audioSliceHash(wav: Uint8Array, startSec: number, durationSec: number): string {
  const layout = parseWav(wav);
  const hash = createHash('sha256');
  if (!layout) return hash.update('file').update(wav).digest('hex');
  const at = (sec: number) => {
    const byte = Math.floor((sec * layout.byteRate) / layout.blockAlign) * layout.blockAlign;
    return Math.min(layout.dataEnd, Math.max(layout.dataStart, layout.dataStart + byte));
  };
  return hash
    .update('slice')
    .update(wav.subarray(layout.fmtStart, layout.fmtEnd))
    .update(wav.subarray(at(startSec), at(startSec + durationSec)))
    .digest('hex');
}

type WavLayout = {
  fmtStart: number;
  fmtEnd: number;
  byteRate: number;
  blockAlign: number;
  dataStart: number;
  dataEnd: number;
};

/** RIFF/WAVE chunk walk; undefined unless it finds a PCM `fmt ` chunk and a `data` chunk. */
export function parseWav(wav: Uint8Array): WavLayout | undefined {
  if (wav.length < 12 || ascii(wav, 0) !== 'RIFF' || ascii(wav, 8) !== 'WAVE') return undefined;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let fmt: Pick<WavLayout, 'fmtStart' | 'fmtEnd' | 'byteRate' | 'blockAlign'> | undefined;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = ascii(wav, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = Math.min(wav.length, start + size);
    if (id === 'fmt ' && size >= 16) {
      const byteRate = view.getUint32(start + 8, true);
      const blockAlign = view.getUint16(start + 12, true);
      if (byteRate > 0 && blockAlign > 0)
        fmt = { fmtStart: start, fmtEnd: end, byteRate, blockAlign };
    }
    if (id === 'data') return fmt ? { ...fmt, dataStart: start, dataEnd: end } : undefined;
    offset = start + size + (size % 2);
  }
  return undefined;
}

function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}
