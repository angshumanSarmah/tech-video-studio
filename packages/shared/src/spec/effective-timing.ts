import { narrationWords } from './narration.ts';
import type { ScriptLayer } from './script.ts';
import type { RenderableVideoSpec } from './shape.ts';
import type { BeatTiming, TimedWord } from './timing.ts';

/** Speaking rate used to estimate timing before TTS exists. */
export const ESTIMATED_WORDS_PER_SEC = 2.6;

/** Silence between estimated beats; matches the timing assembly's default gap (P1B.2). */
export const ESTIMATED_BEAT_GAP_SEC = 0.15;

/** Held after the last beat so the video does not cut on the final word. */
export const END_TAIL_SEC = 0.5;

/** Timing the renderer draws from: the real timing layer, or an estimate when TTS has not run. */
export type EffectiveTiming = {
  estimated: boolean;
  /** One entry per beat, in story order. */
  beats: BeatTiming[];
  /** End of the video, including the tail after the last beat. */
  endSec: number;
};

/** Words spread evenly over `[startSec, startSec + durationSec]`. */
function evenWords(words: readonly string[], startSec: number, durationSec: number): TimedWord[] {
  const step = durationSec / Math.max(words.length, 1);
  return words.map((text, i) => ({
    text,
    startSec: startSec + i * step,
    endSec: startSec + (i + 1) * step,
  }));
}

/** Back-to-back beats timed from word counts at `ESTIMATED_WORDS_PER_SEC`. */
export function estimateBeatTimings(script: ScriptLayer): BeatTiming[] {
  let cursor = 0;
  return script.map((beat) => {
    const words = narrationWords(beat.narration);
    const durationSec = Math.max(words.length, 1) / ESTIMATED_WORDS_PER_SEC;
    const timing = {
      beatId: beat.beatId,
      startSec: cursor,
      endSec: cursor + durationSec,
      words: evenWords(words, cursor, durationSec),
    };
    cursor = timing.endSec + ESTIMATED_BEAT_GAP_SEC;
    return timing;
  });
}

export function effectiveTiming(spec: RenderableVideoSpec): EffectiveTiming {
  const estimated = !spec.timing;
  const beats = spec.timing?.beats ?? estimateBeatTimings(spec.script);
  const lastEnd = beats.at(-1)?.endSec ?? 0;
  return { estimated, beats, endSec: lastEnd + END_TAIL_SEC };
}
