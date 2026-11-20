import { narrationWords, type RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { allFixtureSpecs, rateLimiterSpec, withFormat } from '../../fixtures/index.ts';
import { textWidth } from '../fonts/measure-text.ts';
import { formatAreas } from '../layout/format.ts';
import { getTheme, listThemes } from '../theme/index.ts';
import {
  buildSubtitleCues,
  CUE_LINGER_SEC,
  displayTokens,
  SUBTITLE_STYLE,
  subtitleRoom,
  type SubtitleCue,
} from './cues.ts';
import { MAX_CUE_WORDS } from './chunking.ts';

const paper = getTheme('drafting-paper');

const WORD_SEC = 0.3;
const WORD_GAP_SEC = 0.05;
const BEAT_GAP_SEC = 0.5;

type BeatInput = {
  narration: string;
  /** Extra silence after the word at this index (0-based), in seconds. */
  pausesAfter?: Record<number, number>;
};

/**
 * The rate-limiter fixture cut to `beats.length` beats with these narrations and real-looking
 * timing: each word `WORD_SEC` long, `WORD_GAP_SEC` apart, plus the given pauses.
 */
function timedSpec(beats: readonly BeatInput[]): RenderableVideoSpec {
  let cursor = 0;
  const timed = beats.map((beat, b) => {
    const beatId = rateLimiterSpec.script[b]!.beatId;
    const startSec = cursor;
    const words = narrationWords(beat.narration).map((text, i) => {
      const word = { text, startSec: cursor, endSec: cursor + WORD_SEC };
      cursor = word.endSec + WORD_GAP_SEC + (beat.pausesAfter?.[i] ?? 0);
      return word;
    });
    const endSec = words.at(-1)!.endSec;
    cursor = endSec + BEAT_GAP_SEC;
    return { beatId, startSec, endSec, words };
  });
  const script = timed.map((_, i) => ({
    ...rateLimiterSpec.script[i]!,
    narration: beats[i]!.narration,
  }));
  return {
    ...rateLimiterSpec,
    script,
    scenes: rateLimiterSpec.scenes.slice(0, beats.length),
    timing: { audioFile: 'narration.wav', beats: timed, events: [], endSec: cursor },
  };
}

const lines = (cues: readonly SubtitleCue[]) => cues.map((c) => c.text);

describe('displayTokens', () => {
  it('keeps words as written and joins punctuation-only tokens to a word', () => {
    expect(displayTokens('Redis, fast — really. “Yes”')).toEqual([
      'Redis,',
      'fast —',
      'really.',
      '“Yes”',
    ]);
    expect(displayTokens('— first word')).toEqual(['— first', 'word']);
  });

  it('has one token per narration word', () => {
    for (const spec of allFixtureSpecs) {
      for (const beat of spec.script) {
        expect(displayTokens(beat.narration)).toHaveLength(narrationWords(beat.narration).length);
      }
    }
  });
});

describe('buildSubtitleCues', () => {
  it('breaks at a narration pause before punctuation or size', () => {
    const spec = timedSpec([
      { narration: 'Every request spends one token from the bucket', pausesAfter: { 1: 0.4 } },
    ]);
    expect(lines(buildSubtitleCues(spec, paper))).toEqual([
      'Every request',
      'spends one token',
      'from the bucket',
    ]);
  });

  it('ignores gaps of at most 0.25 s', () => {
    const spec = timedSpec([
      { narration: 'one two three', pausesAfter: { 0: 0.25 - WORD_GAP_SEC } },
    ]);
    expect(lines(buildSubtitleCues(spec, paper))).toEqual(['one two three']);
  });

  it('breaks after sentence and clause punctuation', () => {
    const spec = timedSpec([
      { narration: 'Your API slows, then falls over. Every other user gets an error.' },
    ]);
    expect(lines(buildSubtitleCues(spec, paper))).toEqual([
      'Your API slows,',
      'then falls over.',
      'Every other user',
      'gets an error.',
    ]);
  });

  it('joins a lone word to the phrase after it, else before it', () => {
    const spec = timedSpec([{ narration: 'So, the cache misses. It fails. Again.' }]);
    expect(lines(buildSubtitleCues(spec, paper))).toEqual([
      'So, the cache misses.',
      'It fails. Again.',
    ]);
  });

  it(`splits long phrases into chunks of at most ${MAX_CUE_WORDS} words, about three each`, () => {
    const spec = timedSpec([{ narration: 'a b c d e f g' }, { narration: 'a b c d e' }]);
    const cues = buildSubtitleCues(spec, paper);
    expect(lines(cues)).toEqual(['a b c d', 'e f g', 'a b c', 'd e']);
  });

  it('does not end a chunk on a word that leans on the next one', () => {
    const spec = timedSpec([
      { narration: 'A rate limiter gives each client a bucket of tokens.' },
      { narration: 'One client sends ten thousand requests a second.' },
    ]);
    expect(lines(buildSubtitleCues(spec, paper))).toEqual([
      'A rate limiter',
      'gives each client',
      'a bucket of tokens.',
      'One client sends',
      'ten thousand requests',
      'a second.',
    ]);
  });

  it('never lets a cue span two beats, even without punctuation or a pause', () => {
    const spec = timedSpec([{ narration: 'one two' }, { narration: 'three four' }]);
    const cues = buildSubtitleCues(spec, paper);
    expect(cues.map((c) => [c.beatId, c.text])).toEqual([
      ['hook', 'one two'],
      ['bucket-intro', 'three four'],
    ]);
    expect(cues[0]!.endSec).toBeLessThanOrEqual(spec.timing!.beats[1]!.startSec);
  });

  it('starts on the first word and lingers past the last, never into the next cue', () => {
    const spec = timedSpec([{ narration: 'one two. three four.', pausesAfter: { 1: 1 } }]);
    const [first, second] = buildSubtitleCues(spec, paper);
    const words = spec.timing!.beats[0]!.words;
    expect(first!.startSec).toBe(words[0]!.startSec);
    expect(first!.endSec).toBeCloseTo(words[1]!.endSec + CUE_LINGER_SEC);
    expect(second!.startSec).toBe(words[2]!.startSec);
    // Back-to-back words: the linger is cut at the next cue's first word.
    const tight = buildSubtitleCues(timedSpec([{ narration: 'one two. three four.' }]), paper);
    expect(tight[0]!.endSec).toBe(tight[1]!.startSec);
  });

  it('shows the narration as written, never the TTS respelling', () => {
    // Timing words are normalised original words ("json"); TTS spoke "jay-son".
    const spec = timedSpec([{ narration: 'The JSON body hits Redis.' }]);
    const cues = buildSubtitleCues(spec, paper);
    expect(lines(cues)).toEqual(['The JSON body', 'hits Redis.']);
    expect(lines(cues).join(' ')).not.toMatch(/jay|reddis/i);
  });

  it('lays words out at their measured offsets, separated by one space', () => {
    const [cue] = buildSubtitleCues(timedSpec([{ narration: 'Burst too fast' }]), paper);
    const space = textWidth(paper, SUBTITLE_STYLE, ' ');
    expect(cue!.words.map((w) => w.x)).toEqual([
      0,
      cue!.words[0]!.width + space,
      cue!.words[0]!.width + space + cue!.words[1]!.width + space,
    ]);
    expect(cue!.width).toBeCloseTo(textWidth(paper, SUBTITLE_STYLE, 'Burst too fast'));
    expect(cue!.scale).toBe(1);
  });

  it('splits by measured width when four words do not fit the line', () => {
    const long = 'internationalisation decentralisation acknowledgement interoperability';
    const cues = buildSubtitleCues(timedSpec([{ narration: long }]), paper);
    const room = formatAreas(paper, 'full').subtitleBand.width;
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) expect(cue.width).toBeLessThanOrEqual(room + 0.5);
  });

  it('shrinks a single word wider than the band instead of cutting it', () => {
    const word = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
    const [cue] = buildSubtitleCues(timedSpec([{ narration: word }]), paper);
    const room = formatAreas(paper, 'full').subtitleBand.width;
    expect(cue!.text).toBe(word);
    expect(cue!.scale).toBeCloseTo(room / cue!.width);
    expect(cue!.scale).toBeLessThan(1);
  });

  it.each(['full', 'card'] as const)("measures against the %s format's subtitle band", (f) => {
    const spec = withFormat(timedSpec([{ narration: 'one two' }]), f);
    expect(subtitleRoom(paper, spec)).toBe(formatAreas(paper, f).subtitleBand.width);
  });

  it.each(listThemes().map((t) => t.id))(
    'covers every word of every fixture once, in order, without overlaps (%s)',
    (themeId) => {
      const theme = getTheme(themeId);
      for (const spec of allFixtureSpecs) {
        const cues = buildSubtitleCues(spec, theme);
        const shown = cues.flatMap((c) => c.words.map((w) => w.text));
        expect(shown).toEqual(spec.script.flatMap((s) => displayTokens(s.narration)));
        cues.forEach((cue, i) => {
          expect(cue.words.length).toBeLessThanOrEqual(MAX_CUE_WORDS);
          expect(cue.endSec).toBeGreaterThan(cue.startSec);
          const next = cues[i + 1];
          if (next) expect(cue.endSec).toBeLessThanOrEqual(next.startSec);
        });
      }
    },
  );
});
