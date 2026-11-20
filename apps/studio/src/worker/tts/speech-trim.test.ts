import { describe, expect, it } from 'vitest';
import { trimToSpeech, wavEnvelope, type Envelope } from './speech-trim.ts';

/** 5 ms frames; `loud` lists [from, to) seconds of speech, everything else is silence. */
function envelope(durationSec: number, loud: [number, number][]): Envelope {
  const frameSec = 0.005;
  const rms = new Float32Array(Math.round(durationSec / frameSec));
  for (const [from, to] of loud) {
    for (let i = Math.round(from / frameSec); i < Math.round(to / frameSec); i++) rms[i] = 0.3;
  }
  return { frameSec, rms };
}

const w = (text: string, startSec: number, endSec: number) => ({ text, startSec, endSec });

describe('trimToSpeech', () => {
  it('pulls a word end in from the pause the engine gave it', () => {
    // "dry" is audible 1.0-1.4 s, the engine timed it 1.0-1.8 s (pause included).
    const words = [w('dry', 1, 1.8), w('no', 1.85, 2.2)];
    const trimmed = trimToSpeech(
      words,
      envelope(3, [
        [1, 1.4],
        [1.9, 2.2],
      ]),
    );
    expect(trimmed[0]).toEqual(w('dry', 1, 1.42));
  });

  it('pulls a word start in when it begins with silence', () => {
    const trimmed = trimToSpeech([w('no', 1.8, 2.2)], envelope(3, [[1.92, 2.2]]));
    expect(trimmed[0]).toEqual(w('no', 1.9, 2.2));
  });

  it('leaves short closures and fully audible words alone', () => {
    // 40 ms of silence at the end is a stop closure, not a pause.
    const words = [w('stop', 0, 0.5), w('go', 0.5, 0.9)];
    expect(
      trimToSpeech(
        words,
        envelope(1, [
          [0, 0.46],
          [0.5, 0.9],
        ]),
      ),
    ).toEqual(words);
  });

  it('leaves a word with no audible frame as the engine timed it', () => {
    const words = [w('hm', 0.2, 0.4)];
    expect(trimToSpeech(words, envelope(1, [[0.6, 0.9]]))).toEqual(words);
  });

  it('only shrinks spans, so order is kept', () => {
    const words = [w('a', 0, 0.6), w('b', 0.6, 1.4), w('c', 1.4, 2)];
    const trimmed = trimToSpeech(
      words,
      envelope(2, [
        [0.1, 0.3],
        [0.9, 1],
        [1.5, 1.9],
      ]),
    );
    for (const [i, word] of trimmed.entries()) {
      expect(word.startSec).toBeGreaterThanOrEqual(words[i]!.startSec);
      expect(word.endSec).toBeLessThanOrEqual(words[i]!.endSec);
    }
  });
});

describe('wavEnvelope', () => {
  it('reads a 16-bit mono WAV into RMS frames', () => {
    const sampleRate = 8000;
    const samples = 800; // 0.1 s: silence, then full scale
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF', 0);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(samples * 2, 40);
    for (let i = samples / 2; i < samples; i++)
      wav.writeInt16LE(i % 2 ? 16384 : -16384, 44 + i * 2);
    const { frameSec, rms } = wavEnvelope(wav);
    expect(frameSec).toBe(0.005);
    expect(rms).toHaveLength(20);
    expect(rms[0]).toBe(0);
    expect(rms[19]).toBeCloseTo(0.5);
  });

  it('refuses anything but 16-bit mono PCM', () => {
    expect(() => wavEnvelope(Buffer.from('RIFF-not-a-wav'))).toThrow(/16-bit mono/);
  });
});
