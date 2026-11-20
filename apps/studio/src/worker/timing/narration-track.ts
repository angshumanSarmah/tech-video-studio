import { parseWav } from '../render/audio.ts';

/** A beat's WAV and where it starts on the track (seconds). */
export interface TrackSegment {
  readonly wav: Uint8Array;
  readonly startSec: number;
}

interface PcmFormat {
  readonly sampleRate: number;
  readonly blockAlign: number;
}

function pcmOf(wav: Uint8Array, label: string) {
  const layout = parseWav(wav);
  if (!layout) throw new Error(`${label} is not a PCM WAV.`);
  const format: PcmFormat = {
    sampleRate: layout.byteRate / layout.blockAlign,
    blockAlign: layout.blockAlign,
  };
  return { format, data: wav.subarray(layout.dataStart, layout.dataEnd) };
}

/** A canonical 44-byte PCM WAV header (16-bit samples). */
function wavHeader(format: PcmFormat, dataBytes: number): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const tag = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, format.blockAlign / 2, true); // channels (16-bit samples)
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.sampleRate * format.blockAlign, true);
  view.setUint16(32, format.blockAlign, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, dataBytes, true);
  return header;
}

/**
 * One narration WAV of `totalSec`: silence, with each segment's PCM copied in at its start (rounded
 * to the nearest sample). Every segment must share one 16-bit PCM format (Kokoro's 24 kHz mono).
 * Pure.
 */
export function buildNarrationTrack(
  segments: readonly TrackSegment[],
  totalSec: number,
): Uint8Array {
  const pcm = segments.map((s, i) => ({ ...pcmOf(s.wav, `Segment ${i}`), startSec: s.startSec }));
  const format = pcm[0]?.format;
  if (!format) throw new Error('A narration track needs at least one segment.');
  for (const [i, p] of pcm.entries()) {
    if (p.format.sampleRate !== format.sampleRate || p.format.blockAlign !== format.blockAlign) {
      throw new Error(`Segment ${i} has a different PCM format than segment 0.`);
    }
  }
  const frameOf = (sec: number) => Math.round(sec * format.sampleRate);
  const lastEnd = Math.max(
    ...pcm.map((p) => frameOf(p.startSec) * format.blockAlign + p.data.length),
  );
  const dataBytes = Math.max(frameOf(totalSec) * format.blockAlign, lastEnd);
  const track = new Uint8Array(44 + dataBytes);
  track.set(wavHeader(format, dataBytes), 0);
  for (const p of pcm) track.set(p.data, 44 + frameOf(p.startSec) * format.blockAlign);
  return track;
}
