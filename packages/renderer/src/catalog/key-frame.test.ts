import { effectiveTiming } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { allFixtureSpecs, goldenFixtures, rateLimiterSpec } from '../../fixtures/index.ts';
import { endingStartSec } from '../ending/ending-state.ts';
import { ZOOM_PUSH_SEC } from '../events/presets.ts';
import { beatFrameSpans, secToFrame } from '../timing/frames.ts';
import { beatKeyFrame } from './key-frame.ts';

describe('beatKeyFrame', () => {
  it('lands inside every beat of every fixture, clear of the zoom push', () => {
    for (const spec of allFixtureSpecs) {
      for (const fps of [15, 30]) {
        for (const span of beatFrameSpans(effectiveTiming(spec), fps)) {
          const frame = beatKeyFrame(spec, span.beatId, fps);
          const pushFrames = Math.ceil(ZOOM_PUSH_SEC * fps);
          expect(frame).toBeGreaterThanOrEqual(0);
          expect(frame).toBeLessThan(Math.max(1, span.durationInFrames - pushFrames));
        }
      }
    }
  });

  it('waits until the last entrance has played out', () => {
    const fps = 30;
    const span = beatFrameSpans(effectiveTiming(rateLimiterSpec), fps).find(
      (s) => s.beatId === 'bucket-empty',
    );
    const frame = beatKeyFrame(rateLimiterSpec, 'bucket-empty', fps);
    expect(span).toBeDefined();
    // Past the beat's opening moment: something has been brought on and settled.
    expect(frame).toBeGreaterThan(Math.round(0.45 * fps));
  });

  it('agrees between the draft and final frame rates (same moment in seconds)', () => {
    const draft = beatKeyFrame(rateLimiterSpec, 'payoff', 15) / 15;
    const final = beatKeyFrame(rateLimiterSpec, 'payoff', 30) / 30;
    expect(Math.abs(draft - final)).toBeLessThanOrEqual(1 / 15);
  });

  it("previews the final beat's board before the ending card covers it", () => {
    for (const { spec } of goldenFixtures) {
      for (const fps of [15, 30]) {
        const timing = effectiveTiming(spec);
        const last = beatFrameSpans(timing, fps).at(-1);
        if (!last) throw new Error('no beats');
        const card = secToFrame(endingStartSec(spec, timing) ?? 0, fps);
        expect(last.from + beatKeyFrame(spec, last.beatId, fps)).toBeLessThan(card);
      }
    }
  });

  it('throws for an unknown beat', () => {
    expect(() => beatKeyFrame(rateLimiterSpec, 'nope', 30)).toThrow(/Unknown beat "nope"/);
  });
});
