import { describe, expect, it } from 'vitest';
import { audioSliceHash, parseWav } from './audio.ts';
import { makeWav } from './testing.ts';

const ramp = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('parseWav', () => {
  it('finds the PCM format and data chunk past other chunks', () => {
    const layout = parseWav(makeWav(ramp(10)));
    expect(layout).toMatchObject({ byteRate: 2000, blockAlign: 2, dataEnd: 84 });
    expect(layout!.dataEnd - layout!.dataStart).toBe(20);
  });

  it('rejects files that are not RIFF/WAVE', () => {
    expect(parseWav(new TextEncoder().encode('not a wav file at all'))).toBeUndefined();
  });
});

describe('audioSliceHash', () => {
  const wav = makeWav(ramp(3000)); // 3 s at 1 kHz

  it('ignores audio outside the slice (re-synthesising another beat keeps this clip)', () => {
    const edited = makeWav(ramp(3000).map((s, i) => (i >= 2000 ? -s : s)));
    expect(audioSliceHash(edited, 0.5, 1)).toBe(audioSliceHash(wav, 0.5, 1));
  });

  it('changes when audio inside the slice, or the slice itself, changes', () => {
    const edited = makeWav(ramp(3000).map((s, i) => (i === 900 ? 7 : s)));
    expect(audioSliceHash(edited, 0.5, 1)).not.toBe(audioSliceHash(wav, 0.5, 1));
    expect(audioSliceHash(wav, 0.6, 1)).not.toBe(audioSliceHash(wav, 0.5, 1));
  });

  it('falls back to the whole file for anything that is not a PCM WAV', () => {
    const other = new TextEncoder().encode('compressed audio');
    expect(audioSliceHash(other, 0, 1)).toBe(audioSliceHash(other, 5, 9));
  });
});
