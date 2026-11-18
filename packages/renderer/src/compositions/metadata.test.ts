import { effectiveTiming } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { fixtureSeries, rateLimiterSpec } from '../../fixtures/index.ts';
import { beatMetadata, findBeatSpan, parseRenderableSpec, videoMetadata } from './metadata.ts';
import type { VideoFromSpecProps } from './props.ts';

const props: VideoFromSpecProps = {
  spec: rateLimiterSpec,
  series: fixtureSeries,
  audioSrc: null,
  fps: 30,
};

describe('parseRenderableSpec', () => {
  it('throws with every structured error', () => {
    const broken = { ...rateLimiterSpec, scenes: undefined };
    expect(() => parseRenderableSpec(broken)).toThrow(/Invalid VideoSpec:\n {2}\$\.scenes \[/);
  });
});

describe('videoMetadata', () => {
  it('estimates duration from word counts when the fixture has no timing', () => {
    const { durationInFrames, fps } = videoMetadata(props);
    expect(rateLimiterSpec.timing).toBeUndefined();
    expect(fps).toBe(30);
    expect(durationInFrames).toBe(Math.ceil(effectiveTiming(rateLimiterSpec).endSec * 30));
  });

  it('halves the frame count at the draft fps', () => {
    const final = videoMetadata(props).durationInFrames;
    const draft = videoMetadata({ ...props, fps: 15 }).durationInFrames;
    expect(Math.abs(draft - final / 2)).toBeLessThanOrEqual(1);
  });

  it('rejects a non-integer fps', () => {
    expect(() => videoMetadata({ ...props, fps: 29.97 })).toThrow(/fps/);
  });
});

describe('beatMetadata', () => {
  it('lasts as long as the beat span in the whole video', () => {
    const { durationInFrames } = beatMetadata({ ...props, beatId: 'bucket-empty' });
    expect(durationInFrames).toBe(
      findBeatSpan(rateLimiterSpec, 'bucket-empty', 30).durationInFrames,
    );
  });

  it('names the known beats when the beat id is unknown', () => {
    expect(() => beatMetadata({ ...props, beatId: 'nope' })).toThrow(
      'Unknown beat "nope". Beats in this spec: hook, bucket-intro, bucket-empty, payoff.',
    );
  });
});
