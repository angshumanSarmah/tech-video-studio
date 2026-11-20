import {
  effectiveTiming,
  type BeatScene,
  type BeatTiming,
  type EffectiveTiming,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { allFixtureSpecs } from '../../fixtures/index.ts';
import {
  anchorToFrame,
  beatFrameSpans,
  resolveEventFrames,
  secToFrame,
  totalFrames,
} from './frames.ts';

const narration = 'No token, no request. The bucket says no.';

/** Beat from 2 s to 6 s; word i starts at 2 + 0.5 i. */
const beat: BeatTiming = {
  beatId: 'b',
  startSec: 2,
  endSec: 6,
  words: Array.from({ length: 8 }, (_, i) => ({
    text: `w${i}`,
    startSec: 2 + i * 0.5,
    endSec: 2.4 + i * 0.5,
  })),
};

function timing(spans: [string, number, number][], endSec: number): EffectiveTiming {
  return {
    estimated: false,
    beats: spans.map(([beatId, startSec, end]) => ({ beatId, startSec, endSec: end, words: [] })),
    endSec,
  };
}

describe('secToFrame / totalFrames', () => {
  it('rounds seconds to the nearest frame at the preset fps', () => {
    expect(secToFrame(4.15, 30)).toBe(125);
    expect(secToFrame(4.15, 15)).toBe(62);
  });

  it('covers the whole track, rounding up', () => {
    expect(totalFrames(timing([['a', 0, 10]], 10.51), 30)).toBe(316);
    expect(totalFrames(timing([['a', 0, 0]], 0), 30)).toBe(1);
  });
});

describe('beatFrameSpans', () => {
  const t = timing(
    [
      ['a', 0.3, 4],
      ['b', 4.15, 7],
      ['c', 7.15, 10],
    ],
    10.5,
  );

  it('tiles the video: first from 0, each until the next starts, last to the end', () => {
    expect(beatFrameSpans(t, 30)).toEqual([
      { beatId: 'a', from: 0, durationInFrames: 125 },
      { beatId: 'b', from: 125, durationInFrames: 90 },
      { beatId: 'c', from: 215, durationInFrames: 100 },
    ]);
  });

  it('scales with fps', () => {
    const spans = beatFrameSpans(t, 15);
    expect(spans.map((s) => s.from)).toEqual([0, 62, 107]);
    expect(spans.reduce((sum, s) => sum + s.durationInFrames, 0)).toBe(totalFrames(t, 15));
  });
});

describe('anchorToFrame', () => {
  it('converts word anchors to the frame their word starts', () => {
    expect(anchorToFrame({ type: 'word', index: 1 }, beat, narration, 30)).toBe(75);
    expect(
      anchorToFrame({ type: 'word_text', text: 'no', occurrence: 3 }, beat, narration, 30),
    ).toBe(165);
  });

  it('converts beat-edge anchors', () => {
    expect(anchorToFrame({ type: 'beat', edge: 'end', offsetSec: -0.5 }, beat, narration, 15)).toBe(
      83,
    );
  });

  it('is undefined for an unmatched word', () => {
    expect(
      anchorToFrame({ type: 'word_text', text: 'redis', occurrence: 1 }, beat, narration, 30),
    ).toBeUndefined();
  });
});

describe('resolveEventFrames', () => {
  const scene: BeatScene = {
    beatId: 'b',
    kind: 'board',
    layoutMode: 'centered_focus',
    elements: [],
    patterns: [],
    focus: [],
    transitionIn: 'cut',
    continuesPrevious: false,
    events: [
      { at: { type: 'beat', edge: 'end', offsetSec: 0 }, action: 'dim', targets: ['x'] },
      { at: { type: 'word_text', text: 'redis', occurrence: 1 }, action: 'pulse', targets: ['x'] },
      { at: { type: 'word', index: 0 }, action: 'enter', targets: ['x'] },
    ],
  };

  it('returns resolvable events in frame order, with their global seconds', () => {
    expect(resolveEventFrames(scene, beat, narration, 30)).toEqual([
      { action: 'enter', targets: ['x'], frame: 60, sec: 2, beatEndSec: 6 },
      { action: 'dim', targets: ['x'], frame: 180, sec: 6, beatEndSec: 6 },
    ]);
  });
});

describe('beat spans tile the video (beat clips join without drift)', () => {
  it('are contiguous and sum to the total frames, for every fixture at both presets', () => {
    for (const spec of allFixtureSpecs) {
      const t = effectiveTiming(spec);
      for (const fps of [15, 30]) {
        const spans = beatFrameSpans(t, fps);
        spans.forEach((span, i) => {
          const previous = spans[i - 1];
          expect(span.from).toBe(previous ? previous.from + previous.durationInFrames : 0);
        });
        const sum = spans.reduce((n, s) => n + s.durationInFrames, 0);
        expect(sum).toBe(totalFrames(t, fps));
      }
    }
  });
});
