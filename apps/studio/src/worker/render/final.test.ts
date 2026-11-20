import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { totalFrames } from '@explainer-studio/renderer/catalog';
import { fixtureSeries, rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import { effectiveTiming } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ffSec } from './ffmpeg-args.ts';
import { renderFinal } from './final.ts';
import { readManifest, StillsManifestSchema } from './manifests.ts';
import { renderStills } from './stills.ts';
import type { RenderRun, RenderTarget } from './target.ts';
import { fakeTools, makeWav } from './testing.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'final-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run: RenderRun = { signal: new AbortController().signal, onProgress: () => {} };

function target(audioPath: string | null): RenderTarget {
  return {
    spec: rateLimiterSpec,
    props: { series: fixtureSeries, channelHandle: null },
    audioPath,
  };
}

describe('renderFinal', () => {
  it('renders VideoFromSpec once at 1080x1920 @ 30, H.264 yuv420p, without the badge', async () => {
    const { tools, engine } = fakeTools();
    const out = join(dir, 'exports', 'rate-limiter.mp4');
    const { frames } = await renderFinal(target(null), tools, run, out);

    expect(engine.videos).toHaveLength(1);
    const [request] = engine.videos;
    expect(request).toMatchObject({ compositionId: 'VideoFromSpec', mode: 'final' });
    expect(request!.preset).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(request!.inputProps).toMatchObject({ fps: 30, audioSrc: null });
    expect(request!.inputProps).not.toHaveProperty('draft');
    expect(frames).toBe(totalFrames(effectiveTiming(rateLimiterSpec), 30));
  });

  it('muxes the whole narration from 0 s as AAC 48 kHz with +faststart', async () => {
    const wav = join(dir, 'narration.wav');
    writeFileSync(wav, makeWav([0, 0, 0]));
    const { tools, ff } = fakeTools();
    const out = join(dir, 'out.mp4');
    const { frames } = await renderFinal(target(wav), tools, run, out);

    expect(ff.calls).toHaveLength(1);
    const args = ff.calls[0]!;
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect([value('-ss'), value('-c:v'), value('-c:a'), value('-ar')]).toEqual([
      '0',
      'copy',
      'aac',
      '48000',
    ]);
    expect(value('-movflags')).toBe('+faststart');
    expect(value('-t')).toBe(ffSec(frames / 30));
    expect(existsSync(out)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['narration.wav', 'out.json', 'out.mp4']);
  });
});

describe('renderStills', () => {
  it('renders one still per beat at its key frame, at the draft size', async () => {
    const { tools, engine } = fakeTools();
    const path = (beatId: string) => join(dir, 'stills', `${beatId}.png`);
    const manifest = join(dir, 'stills', 'stills.json');
    const frames = await renderStills(target(null), tools, run, { still: path, manifest });

    expect(Object.keys(frames)).toEqual(['hook', 'bucket-intro', 'bucket-empty', 'payoff']);
    expect(engine.stills.map((s) => [s.inputProps.beatId, s.frame])).toEqual(
      Object.entries(frames),
    );
    for (const still of engine.stills) {
      expect(still.compositionId).toBe('BeatFromSpec');
      expect(still.inputProps).not.toHaveProperty('draft');
      expect(still.preset.width).toBe(540);
    }
    expect(readdirSync(join(dir, 'stills'))).toHaveLength(5);
    expect(readManifest(StillsManifestSchema, manifest)).toEqual({ source: null, fps: 15, frames });
  });
});
