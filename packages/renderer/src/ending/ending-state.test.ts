import {
  effectiveTiming,
  narrationWords,
  type EffectiveTiming,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { goldenRateLimiterSpec, goldenStrawberrySpec } from '../../fixtures/index.ts';
import { secToFrame } from '../timing/frames.ts';
import {
  ENDING_FALLBACK_SEC,
  endingContent,
  endingCue,
  endingHeader,
  endingStartSec,
} from './ending-state.ts';

const FPS = 30;

function withEnding(
  spec: RenderableVideoSpec,
  ending: RenderableVideoSpec['story']['ending'],
): RenderableVideoSpec {
  return { ...spec, story: { ...spec.story, ending } };
}

/** The timing with the final beat's word timings dropped. */
function withoutLastWords(timing: EffectiveTiming): EffectiveTiming {
  return {
    ...timing,
    beats: timing.beats.map((b, i, all) => (i === all.length - 1 ? { ...b, words: [] } : b)),
  };
}

describe('endingContent', () => {
  it('shows the spec card lines under the series label and number, then the CTA', () => {
    const content = endingContent(goldenRateLimiterSpec, 'System Design');
    expect(content?.header).toBe('System Design #12');
    expect(content?.lines).toHaveLength(3);
    expect(content?.cta).toMatch(/^Send this/);
  });

  it('shows only the CTA for an ending without a spec card', () => {
    const content = endingContent(goldenStrawberrySpec, 'AI');
    expect(content).toMatchObject({ header: 'AI', lines: [] });
    expect(content?.cta).toMatch(/^Try it/);
  });

  it('draws no card when the ending has neither lines nor a CTA', () => {
    const spec = withEnding(goldenStrawberrySpec, { kind: 'cliffhanger_ending' });
    expect(endingContent(spec, 'AI')).toBeUndefined();
    expect(endingCue(spec, effectiveTiming(spec), FPS, 'AI')).toBeUndefined();
  });

  it('writes the series number after the label', () => {
    expect(endingHeader('System Design', 7)).toBe('System Design #7');
    expect(endingHeader('AI', undefined)).toBe('AI');
  });
});

describe('endingStartSec', () => {
  it("enters on the first word of the final beat's last sentence", () => {
    const timing = effectiveTiming(goldenRateLimiterSpec);
    const beat = timing.beats.at(-1);
    const narration = goldenRateLimiterSpec.script.at(-1)?.narration ?? '';
    const words = narrationWords(narration);
    const start = words.length - narrationWords('One gate in front keeps the API standing.').length;
    expect(words[start]).toBe('one');
    expect(endingStartSec(goldenRateLimiterSpec, timing)).toBe(beat?.words[start]?.startSec);
  });

  it('falls back to the last 2.5 s of the final beat without word timings', () => {
    const timing = withoutLastWords(effectiveTiming(goldenRateLimiterSpec));
    const beat = timing.beats.at(-1);
    if (!beat) throw new Error('no beats');
    expect(endingStartSec(goldenRateLimiterSpec, timing)).toBeCloseTo(
      beat.endSec - ENDING_FALLBACK_SEC,
    );
  });

  it('never enters before the final beat starts', () => {
    const timing = withoutLastWords(effectiveTiming(goldenRateLimiterSpec));
    const beats = timing.beats.map((b, i, all) =>
      i === all.length - 1 ? { ...b, endSec: b.startSec + 1 } : b,
    );
    const short = { ...timing, beats };
    expect(endingStartSec(goldenRateLimiterSpec, short)).toBe(beats.at(-1)?.startSec);
  });

  it('gives the cue the frame of that time and holds the content', () => {
    const timing = effectiveTiming(goldenStrawberrySpec);
    const cue = endingCue(goldenStrawberrySpec, timing, FPS, 'AI');
    expect(cue?.from).toBe(secToFrame(endingStartSec(goldenStrawberrySpec, timing) ?? -1, FPS));
    expect(cue?.content.header).toBe('AI');
  });
});
