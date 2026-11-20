import { smoothstep } from '../primitives/geometry.ts';
import type { CueWord, SubtitleCue } from './cues.ts';

/** What the subtitle layer shows at one moment. Pure: frames come in as seconds. */

/** How long the current-word underline takes to slide from one word to the next. */
export const WORD_SLIDE_SEC = 0.08;

/** The cue on screen at `sec` (global seconds), if any. */
export function cueAt(cues: readonly SubtitleCue[], sec: number): SubtitleCue | undefined {
  return cues.find((c) => c.startSec <= sec && sec < c.endSec);
}

/** Index of the word being spoken in `cue` at `sec`: the last that has started (0 before any). */
export function activeWordIndex(cue: SubtitleCue, sec: number): number {
  return Math.max(
    0,
    cue.words.findLastIndex((w) => w.startSec <= sec),
  );
}

/** A horizontal span in the cue's line, unscaled px. */
export type LineSpan = { x: number; width: number };

/**
 * Where the current-word underline sits at `sec`: on the active word, sliding there from the
 * previous word over `WORD_SLIDE_SEC` (eased) once it starts. The first word of a cue has no
 * slide in, so the band never travels across a cue change.
 */
export function underlineSpan(cue: SubtitleCue, sec: number): LineSpan {
  const index = activeWordIndex(cue, sec);
  const current = cue.words[index];
  if (!current) return { x: 0, width: 0 };
  const previous = cue.words[index - 1];
  if (!previous) return span(current);
  const t = smoothstep((sec - current.startSec) / WORD_SLIDE_SEC);
  return {
    x: lerp(previous.x, current.x, t),
    width: lerp(previous.width, current.width, t),
  };
}

function span(word: CueWord): LineSpan {
  return { x: word.x, width: word.width };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
