import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { rateLimiterSpec } from '../../fixtures/index.ts';
import { getTheme, safeAreas } from '../theme/index.ts';
import { anchorToFrame, beatFrameSpans, secToFrame } from '../timing/frames.ts';
import {
  activeAt,
  beatHasHeadline,
  chapterSpans,
  clockValueAt,
  formatClock,
  headlineCues,
  stageForBeat,
  storyClockPoints,
  visibleHudParts,
} from './hud-state.ts';

const FPS = 30;
const spec = rateLimiterSpec;
const timing = effectiveTiming(spec);
const spans = beatFrameSpans(timing, FPS);
const span = (beatId: string) => {
  const found = spans.find((s) => s.beatId === beatId);
  if (!found) throw new Error(`no span for ${beatId}`);
  return found;
};
const end = (beatId: string) => span(beatId).from + span(beatId).durationInFrames;

function withSpec(change: (s: RenderableVideoSpec) => RenderableVideoSpec) {
  return change(structuredClone(spec));
}

describe('visibleHudParts', () => {
  it('shows every part of the fixture (chapter header forced on)', () => {
    expect(Object.values(visibleHudParts(spec)).every(Boolean)).toBe(true);
  });

  it('resolves auto chapter display from the story devices', () => {
    const auto = (devices: string[]) =>
      visibleHudParts(
        withSpec((s) => ({
          ...s,
          hud: { ...s.hud, chapterHeader: 'auto' },
          story: { ...s.story, devices },
        })),
      );
    expect(auto(['failure_before_fix'])).toMatchObject({ chapterHeader: false, stepTracker: true });
    expect(auto(['question_chapters'])).toMatchObject({ chapterHeader: true, stepTracker: false });
  });

  it('hides parts toggled off in the spec', () => {
    const parts = visibleHudParts(
      withSpec((s) => ({ ...s, hud: { ...s.hud, stepTracker: false } })),
    );
    expect(parts.stepTracker).toBe(false);
    expect(parts.chapterHeader).toBe(true);
  });

  it('hides parts with no data even when toggled on', () => {
    const parts = visibleHudParts(
      withSpec((s) => ({ ...s, story: { ...s.story, heroMetric: undefined } })),
    );
    expect(parts).toMatchObject({ heroMetric: false, storyClock: false });
  });

  it('shows the story clock without the pill', () => {
    const parts = visibleHudParts(
      withSpec((s) => ({ ...s, hud: { ...s.hud, heroMetric: false } })),
    );
    expect(parts).toMatchObject({ heroMetric: false, storyClock: true });
  });
});

describe('beatHasHeadline / stageForBeat', () => {
  const areas = safeAreas(getTheme());

  it('reserves the headline band only on beats with a headline', () => {
    const noHeadline = withSpec((s) => {
      const beat = s.script[1];
      if (beat) delete beat.headline;
      return s;
    });
    expect(stageForBeat(areas, noHeadline, 'hook')).toEqual(areas.stageWithHeadline);
    expect(stageForBeat(areas, noHeadline, 'bucket-intro')).toEqual(areas.stage);
  });

  it('gives every beat the full stage when headlines are toggled off', () => {
    const off = withSpec((s) => ({ ...s, hud: { ...s.hud, headline: false } }));
    expect(beatHasHeadline(off, 'hook')).toBe(false);
    expect(stageForBeat(areas, off, 'hook')).toEqual(areas.stage);
  });
});

describe('chapterSpans', () => {
  const chapters = chapterSpans(spec, spans);

  it('spans each chapter from its first beat to its last, in order', () => {
    expect(chapters.map((c) => [c.chapterId, c.index, c.from, c.to])).toEqual([
      ['flood', 0, 0, end('hook')],
      ['bucket', 1, span('bucket-intro').from, end('bucket-empty')],
      ['payoff', 2, span('payoff').from, end('payoff')],
    ]);
  });

  it('heads a chapter with its question when it has one', () => {
    expect(chapters.map((c) => c.heading)).toEqual([
      'Why did the API crash?',
      'Token bucket',
      'Why it holds',
    ]);
  });

  it('finds the chapter at a frame', () => {
    expect(activeAt(chapters, 0)?.chapterId).toBe('flood');
    expect(activeAt(chapters, span('bucket-empty').from)?.chapterId).toBe('bucket');
    expect(activeAt(chapters, end('payoff') - 1)?.chapterId).toBe('payoff');
  });
});

describe('headlineCues', () => {
  const cues = headlineCues(spec, timing, spans, FPS);
  const words = (beatId: string) => timing.beats.find((b) => b.beatId === beatId);

  it('starts a word-anchored headline on its word and holds it to the end of the beat', () => {
    const hook = cues.find((c) => c.beatId === 'hook');
    const beat = words('hook');
    const narration = spec.script[0]?.narration ?? '';
    if (!beat) throw new Error('no timing for hook');
    expect(hook).toMatchObject({
      semantic: 'problem',
      from: anchorToFrame(
        { type: 'word_text', text: 'falls', occurrence: 1 },
        beat,
        narration,
        FPS,
      ),
      to: end('hook'),
    });
  });

  it('defaults to 0.3 s after the beat starts', () => {
    const intro = cues.find((c) => c.beatId === 'bucket-intro');
    expect(intro?.from).toBe(secToFrame((words('bucket-intro')?.startSec ?? 0) + 0.3, FPS));
  });

  it('has one cue per beat with a headline', () => {
    expect(cues.map((c) => c.beatId)).toEqual(['hook', 'bucket-intro', 'bucket-empty', 'payoff']);
  });
});

describe('story clock', () => {
  const clock = spec.story.heroMetric?.storyClock;
  if (!clock) throw new Error('fixture has no story clock');
  const points = storyClockPoints(clock, timing);
  const beat = (id: string) => timing.beats.find((b) => b.beatId === id);

  it('runs from the first beat start through keyframes to the last beat end', () => {
    expect(points).toEqual([
      { sec: beat('hook')?.startSec, value: 0 },
      { sec: beat('bucket-empty')?.startSec, value: 120 },
      { sec: beat('payoff')?.endSec, value: 180 },
    ]);
  });

  it('interpolates linearly between points and holds outside them', () => {
    const [a, b] = points;
    if (!a || !b) throw new Error('expected points');
    expect(clockValueAt(points, (a.sec + b.sec) / 2)).toBeCloseTo(60);
    expect(clockValueAt(points, -1)).toBe(0);
    expect(clockValueAt(points, timing.endSec + 5)).toBe(180);
  });

  it('is linear start to end without keyframes', () => {
    const linear = storyClockPoints({ ...clock, keyframes: [] }, timing);
    expect(linear).toHaveLength(2);
    expect(clockValueAt(linear, (beat('payoff')?.endSec ?? 0) / 2)).toBeCloseTo(90);
  });
});

describe('formatClock', () => {
  it.each([
    [0, '0:00'],
    [7.9, '0:07'],
    [112, '1:52'],
    [3725, '1:02:05'],
    [-3, '0:00'],
  ])('%s s -> %s', (value, text) => {
    expect(formatClock(value)).toBe(text);
  });
});
