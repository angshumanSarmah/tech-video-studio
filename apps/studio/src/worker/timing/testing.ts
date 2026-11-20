import { narrationWords, type BeatScript } from '@explainer-studio/shared';
import { makeWav } from '../render/testing.ts';
import type { NarratedBeat } from './step.ts';

/** Fake narration rate: one word every 0.2 s after 0.1 s of lead-in, WAVs at 1 kHz. */
export const FAKE_WORD_SEC = 0.2;
export const FAKE_SAMPLE_RATE = 1000;

/** Narration for a beat as a fake engine would time it, with a 1 kHz WAV of the same length. */
export function fakeNarratedBeat(beat: Pick<BeatScript, 'beatId' | 'narration'>): NarratedBeat {
  const words = narrationWords(beat.narration).map((text, i) => ({
    text,
    startSec: 0.1 + i * FAKE_WORD_SEC,
    endSec: 0.1 + (i + 1) * FAKE_WORD_SEC - 0.02,
  }));
  const durationSec = 0.1 + words.length * FAKE_WORD_SEC + 0.1;
  const samples = Array.from({ length: Math.round(durationSec * FAKE_SAMPLE_RATE) }, () => 1000);
  return { beatId: beat.beatId, durationSec, words, wav: makeWav(samples, FAKE_SAMPLE_RATE) };
}
