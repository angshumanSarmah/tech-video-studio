import { describe, expect, it } from 'vitest';
import { parseWav } from '../render/audio.ts';
import { makeWav } from '../render/testing.ts';
import { buildNarrationTrack } from './narration-track.ts';

function samplesOf(wav: Uint8Array): number[] {
  const layout = parseWav(wav);
  if (!layout) throw new Error('not a wav');
  const view = new DataView(wav.buffer, wav.byteOffset + layout.dataStart);
  return Array.from({ length: (layout.dataEnd - layout.dataStart) / 2 }, (_, i) =>
    view.getInt16(i * 2, true),
  );
}

describe('buildNarrationTrack', () => {
  it('places each segment at its start with silence around it, padded to the total', () => {
    // 10 Hz "WAVs": a = 3 samples, b = 2 samples.
    const a = makeWav([1, 2, 3], 10);
    const b = makeWav([7, 8], 10);
    const track = buildNarrationTrack(
      [
        { wav: a, startSec: 0 },
        { wav: b, startSec: 0.5 },
      ],
      1,
    );
    expect(samplesOf(track)).toEqual([1, 2, 3, 0, 0, 7, 8, 0, 0, 0]);
    expect(parseWav(track)?.byteRate).toBe(20);
  });

  it('never cuts a segment that runs past the total', () => {
    const track = buildNarrationTrack([{ wav: makeWav([1, 2, 3], 10), startSec: 0 }], 0.1);
    expect(samplesOf(track)).toEqual([1, 2, 3]);
  });

  it('refuses segments in different formats', () => {
    const segments = [
      { wav: makeWav([1], 10), startSec: 0 },
      { wav: makeWav([1], 20), startSec: 1 },
    ];
    expect(() => buildNarrationTrack(segments, 2)).toThrow(/different PCM format/);
  });
});
