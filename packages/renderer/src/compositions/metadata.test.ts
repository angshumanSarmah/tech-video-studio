import { effectiveTiming } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { fixtureSeries, rateLimiterSpec } from '../../fixtures/index.ts';
import { beatMetadata, findBeatSpan, parseRenderableSpec, videoMetadata } from './metadata.ts';
import type { VideoFromSpecProps } from './props.ts';

const props: VideoFromSpecProps = {
  spec: rateLimiterSpec,
  series: fixtureSeries,
  audioSrc: null,
  channelHandle: null,
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

  it('sizes the canvas from the default theme, or from themeId', () => {
    expect(videoMetadata(props)).toMatchObject({ width: 1080, height: 1920 });
    const paper = videoMetadata({ ...props, themeId: 'drafting-paper' });
    expect(paper).toMatchObject({ width: 1080, height: 1920 });
    expect(paper.props.themeId).toBe('drafting-paper');
  });

  it('rejects an unknown themeId and lists the known ones', () => {
    expect(() => videoMetadata({ ...props, themeId: 'neon-pink' })).toThrow(
      /Unknown theme "neon-pink".*drafting-paper/,
    );
    expect(() => beatMetadata({ ...props, themeId: 'neon-pink', beatId: 'hook' })).toThrow(
      /Unknown theme/,
    );
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

describe('assets prop', () => {
  it('passes valid resolved assets through and rejects invalid ones with a path', async () => {
    const { parseRenderAssets } = await import('./metadata.ts');
    expect(parseRenderAssets(undefined)).toBeUndefined();
    const logo = {
      kind: 'logo',
      id: 'logo_example',
      mime: 'image/png',
      dataUri: 'data:image/png;base64,AA==',
    };
    expect(parseRenderAssets([logo])).toEqual([logo]);
    expect(() => parseRenderAssets([{ ...logo, dataUri: 'https://example.com/logo.png' }])).toThrow(
      /^Invalid assets:\n {2}assets\.0\.dataUri/,
    );
  });
});
