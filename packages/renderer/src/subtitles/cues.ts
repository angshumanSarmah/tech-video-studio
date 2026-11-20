import {
  effectiveTiming,
  normalizeWord,
  type EffectiveTiming,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import { fitsLine, textWidth } from '../fonts/measure-text.ts';
import { formatAreas } from '../layout/format.ts';
import type { Theme } from '../theme/index.ts';
import { sceneEndSec } from '../timing/frames.ts';
import { chunkTokens, lineText, type TimedToken } from './chunking.ts';

/**
 * Subtitle cues: the one source of truth for the burned-in captions (`<Subtitles/>`) and the SRT
 * the worker exports next to the final video, so the two can never disagree. Pure, React-free.
 *
 * A beat's words are split, in order of preference:
 *   1. at narration pauses: a gap longer than `PAUSE_BREAK_SEC` between one word's end and the
 *      next one's start (word edges are trimmed to audible speech by TTS), and at beat edges
 *      (a cue never spans two beats, so beat gaps always break);
 *   2. after punctuation (a sentence or clause end), joining a lone word to a neighbour;
 *   3. into chunks of at most `MAX_CUE_WORDS` words that fit one line of the format's subtitle
 *      band, measured with `textWidth` (real glyph advances): few chunks of about three words,
 *      none ending on a word that leans on the next (`chunking.ts`).
 * Cues are one line. A single word wider than the band is drawn scaled down (`scale < 1`), never
 * cut, and `subtitleWarnings` reports it.
 */

export const SUBTITLE_STYLE = 'subtitle';

/** How long a cue stays after its last word ends (never into the next cue or past its scene). */
export const CUE_LINGER_SEC = 0.3;

export type CueWord = {
  /** The narration token as written ("Redis," "JSON"), never the TTS respelling. */
  text: string;
  startSec: number;
  endSec: number;
  /** Left edge in the cue's line, unscaled px (0 = the line's start). */
  x: number;
  /** Measured width, unscaled px. */
  width: number;
};

export type SubtitleCue = {
  beatId: string;
  /** Global seconds: the first word's start. */
  startSec: number;
  /** Global seconds: the last word's end plus the linger, clamped to the next cue and scene end. */
  endSec: number;
  words: CueWord[];
  /** The line as shown (words joined by single spaces). */
  text: string;
  /** Measured line width, unscaled px. */
  width: number;
  /** 1, or less when one word alone is wider than the band (it is shrunk to fit, not cut). */
  scale: number;
};

/** Every cue of the video, in time order, laid out for the spec's format in `theme`. */
export function buildSubtitleCues(
  spec: RenderableVideoSpec,
  theme: Theme,
  timing: EffectiveTiming = effectiveTiming(spec),
): SubtitleCue[] {
  const room = subtitleRoom(theme, spec);
  return timing.beats.flatMap((beat) => {
    const narration = spec.script.find((s) => s.beatId === beat.beatId)?.narration ?? '';
    const tokens = displayTokens(narration).map((text, i) => {
      const word = beat.words[i];
      return {
        text,
        startSec: word?.startSec ?? beat.startSec,
        endSec: word?.endSec ?? beat.endSec,
      };
    });
    const chunks = chunkTokens(tokens, (line) => fitsLine(theme, SUBTITLE_STYLE, line, room));
    return timeChunks(chunks, sceneEndSec(timing, beat.beatId)).map((chunk) =>
      layoutCue(theme, beat.beatId, chunk, room),
    );
  });
}

/** Width a cue line may take: the format's subtitle band. */
export function subtitleRoom(theme: Theme, spec: RenderableVideoSpec): number {
  return formatAreas(theme, spec.meta.format).subtitleBand.width;
}

/**
 * Narration tokens as written, one per `narrationWords()` word. A token that is only punctuation
 * ("—") is not a word, so it joins the word before it (or after it, at the start).
 */
export function displayTokens(narration: string): string[] {
  const tokens: string[] = [];
  let leading = '';
  for (const token of narration.split(/\s+/).filter((t) => t.length > 0)) {
    if (normalizeWord(token).length > 0) {
      tokens.push(leading ? `${leading} ${token}` : token);
      leading = '';
    } else if (tokens.length > 0) {
      tokens[tokens.length - 1] = `${tokens.at(-1)} ${token}`;
    } else {
      leading = leading ? `${leading} ${token}` : token;
    }
  }
  return tokens;
}

type TimedChunk<T> = { tokens: T[]; startSec: number; endSec: number };

/** Each chunk shows from its first word until it has lingered, the next cue or the scene ends. */
function timeChunks<T extends TimedToken>(
  chunks: readonly T[][],
  sceneEnd: number,
): TimedChunk<T>[] {
  return chunks.flatMap((tokens, i) => {
    const first = tokens[0];
    const last = tokens.at(-1);
    if (!first || !last) return [];
    const nextStart = chunks[i + 1]?.[0]?.startSec ?? sceneEnd;
    const endSec = Math.max(
      Math.min(last.endSec + CUE_LINGER_SEC, nextStart, sceneEnd),
      last.endSec,
    );
    return [{ tokens, startSec: first.startSec, endSec }];
  });
}

function layoutCue(
  theme: Theme,
  beatId: string,
  chunk: TimedChunk<TimedToken>,
  room: number,
): SubtitleCue {
  const space = textWidth(theme, SUBTITLE_STYLE, ' ');
  let x = 0;
  const words = chunk.tokens.map((token, i) => {
    const width = textWidth(theme, SUBTITLE_STYLE, token.text);
    const word = { ...token, x: x + (i > 0 ? space : 0), width };
    x = word.x + width;
    return word;
  });
  return {
    beatId,
    startSec: chunk.startSec,
    endSec: chunk.endSec,
    words,
    text: lineText(chunk.tokens),
    width: x,
    scale: x > room ? room / x : 1,
  };
}
