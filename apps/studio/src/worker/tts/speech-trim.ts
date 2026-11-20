import type { TimedWord } from '@explainer-studio/shared';
import { parseWav } from '#worker/render/audio.ts';

/**
 * Kokoro's duration predictor gives the pause after a phrase to its last word (and part of a
 * pause to the next word's start), so word spans run past audible speech by up to ~0.35 s. These
 * pure functions pull a word's start and end in to its audible part, only where a real silence
 * sits inside its span; mid-phrase word boundaries are never moved.
 */

/** RMS frame length. */
export const FRAME_SEC = 0.005;
/** A frame is speech above this fraction of the loudest frame (-40 dB). */
const SPEECH_FRACTION = 0.01;
/** Silence inside a word's span shorter than this is a stop or closure, not a pause. */
const MIN_SILENCE_SEC = 0.06;
/** Kept around the audible part so soft onsets and releases stay inside the word. */
const PAD_SEC = 0.02;
const MIN_WORD_SEC = 0.05;

export interface Envelope {
  readonly frameSec: number;
  /** RMS per frame, samples scaled to [-1, 1]. */
  readonly rms: Float32Array;
}

/** RMS envelope of a 16-bit mono PCM WAV (what the Kokoro server writes). */
export function wavEnvelope(wav: Uint8Array, frameSec = FRAME_SEC): Envelope {
  const layout = parseWav(wav);
  if (!layout || layout.blockAlign !== 2) throw new Error('Expected a 16-bit mono PCM WAV.');
  const sampleRate = layout.byteRate / layout.blockAlign;
  const view = new DataView(wav.buffer, wav.byteOffset + layout.dataStart);
  const samples = Math.floor((layout.dataEnd - layout.dataStart) / 2);
  const perFrame = Math.max(1, Math.round(sampleRate * frameSec));
  const rms = new Float32Array(Math.ceil(samples / perFrame));
  for (let frame = 0; frame < rms.length; frame++) {
    const end = Math.min(samples, (frame + 1) * perFrame);
    let sum = 0;
    for (let i = frame * perFrame; i < end; i++) sum += (view.getInt16(i * 2, true) / 32768) ** 2;
    rms[frame] = Math.sqrt(sum / (end - frame * perFrame));
  }
  return { frameSec: perFrame / sampleRate, rms };
}

/** Audible part of `[startSec, endSec)`: first and last speech frame times, or undefined. */
function audibleSpan(envelope: Envelope, threshold: number, startSec: number, endSec: number) {
  const { frameSec, rms } = envelope;
  const from = Math.max(0, Math.floor(startSec / frameSec));
  const to = Math.min(rms.length, Math.ceil(endSec / frameSec));
  let first = -1;
  let last = -1;
  for (let i = from; i < to; i++) {
    if ((rms[i] ?? 0) <= threshold) continue;
    if (first < 0) first = i;
    last = i;
  }
  return first < 0 ? undefined : { startSec: first * frameSec, endSec: (last + 1) * frameSec };
}

/** One word pulled in to its audible part where a silence of `MIN_SILENCE_SEC` borders it. */
function trimWord(word: TimedWord, envelope: Envelope, threshold: number): TimedWord {
  const audible = audibleSpan(envelope, threshold, word.startSec, word.endSec);
  if (!audible) return word;
  let { startSec, endSec } = word;
  if (audible.startSec - startSec >= MIN_SILENCE_SEC) startSec = audible.startSec - PAD_SEC;
  if (endSec - audible.endSec >= MIN_SILENCE_SEC) endSec = audible.endSec + PAD_SEC;
  if (endSec - startSec < MIN_WORD_SEC) return word;
  const round = (sec: number) => Math.round(sec * 1e4) / 1e4;
  return { ...word, startSec: round(startSec), endSec: round(endSec) };
}

/**
 * Words trimmed to audible speech. Spans only shrink, so order and monotonicity are kept. A word
 * with no audible frame is left as the engine timed it.
 */
export function trimToSpeech(words: readonly TimedWord[], envelope: Envelope): TimedWord[] {
  const peak = envelope.rms.reduce((max, value) => Math.max(max, value), 0);
  const threshold = peak * SPEECH_FRACTION;
  return words.map((word) => trimWord(word, envelope, threshold));
}
