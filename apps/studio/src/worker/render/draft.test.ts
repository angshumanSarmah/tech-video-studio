import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beatFrameSpans, totalFrames } from '@explainer-studio/renderer/catalog';
import { fixtureSeries, rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderBeatDraft, renderDraft, type DraftPaths } from './draft.ts';
import { ffSec } from './ffmpeg-args.ts';
import type { RenderRun, RenderTarget } from './target.ts';
import { fakeTools, makeWav } from './testing.ts';

let dir: string;
let paths: DraftPaths;
const progress: number[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'draft-'));
  paths = {
    clip: (beatId) => join(dir, 'beats', `${beatId}.draft.mp4`),
    meta: (beatId) => join(dir, 'beats', `${beatId}.draft.json`),
    joined: join(dir, 'draft.mp4'),
  };
  progress.length = 0;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (signal = new AbortController().signal): RenderRun => ({
  signal,
  onProgress: (f) => progress.push(f),
});

const target = (spec: RenderableVideoSpec = rateLimiterSpec, audioPath: string | null = null) =>
  ({
    spec,
    props: { series: fixtureSeries, channelHandle: null },
    audioPath,
  }) satisfies RenderTarget;

/** The fixture with one scene's focus changed. */
function editFocus(beatId: string): RenderableVideoSpec {
  return {
    ...rateLimiterSpec,
    scenes: rateLimiterSpec.scenes.map((s) =>
      s.beatId === beatId ? { ...s, focus: [...s.focus, 'edited'] } : s,
    ),
  };
}

const ALL = ['hook', 'bucket-intro', 'bucket-empty', 'payoff'];

describe('renderDraft', () => {
  it('renders every beat clip as BeatFromSpec with the draft badge at the draft preset', async () => {
    const { tools, engine } = fakeTools();
    const result = await renderDraft(target(), tools, run(), paths);
    expect(result.rendered).toEqual(ALL);
    expect(result.reused).toEqual([]);
    expect(engine.sessions()).toBe(1);
    for (const request of engine.videos) {
      expect(request).toMatchObject({ compositionId: 'BeatFromSpec', mode: 'draft' });
      expect(request.preset).toEqual({ width: 540, height: 960, fps: 15 });
      expect(request.inputProps).toMatchObject({ draft: true, audioSrc: null, fps: 15 });
    }
    expect(engine.videos.map((r) => r.inputProps.beatId)).toEqual(ALL);
  });

  it('reuses every clip when nothing changed (no browser opened)', async () => {
    const { tools, engine } = fakeTools();
    await renderDraft(target(), tools, run(), paths);
    const again = await renderDraft(target(), tools, run(), paths);
    expect(again.rendered).toEqual([]);
    expect(again.reused).toEqual(ALL);
    expect(engine.sessions()).toBe(1);
  });

  it('editing one beat re-renders only that beat', async () => {
    const { tools } = fakeTools();
    await renderDraft(target(), tools, run(), paths);
    const edited = await renderDraft(target(editFocus('bucket-empty')), tools, run(), paths);
    expect(edited.rendered).toEqual(['bucket-empty']);
    expect(edited.reused).toEqual(['hook', 'bucket-intro', 'payoff']);
  });

  it('editing a continuing beat re-renders its whole chain (shared layout and camera)', async () => {
    const { tools } = fakeTools();
    await renderDraft(target(), tools, run(), paths);
    const edited = await renderDraft(target(editFocus('bucket-intro')), tools, run(), paths);
    expect(edited.rendered).toEqual(['hook', 'bucket-intro']);
  });

  it('re-renders everything when the renderer changes', async () => {
    await renderDraft(target(), fakeTools('engine-v1').tools, run(), paths);
    const next = await renderDraft(target(), fakeTools('engine-v2').tools, run(), paths);
    expect(next.rendered).toEqual(ALL);
  });

  it('re-renders a clip whose file is gone or whose sidecar is corrupt', async () => {
    const { tools } = fakeTools();
    await renderDraft(target(), tools, run(), paths);
    rmSync(paths.clip('hook'));
    writeFileSync(paths.meta('payoff'), '{');
    const next = await renderDraft(target(), tools, run(), paths);
    expect(next.rendered).toEqual(['hook', 'payoff']);
  });

  it('joins the clips in story order, then lays the whole narration from 0 s', async () => {
    const wav = join(dir, 'narration.wav');
    writeFileSync(wav, makeWav(Array.from({ length: 30_000 }, () => 0)));
    const { tools, ff } = fakeTools();
    const result = await renderDraft(target(rateLimiterSpec, wav), tools, run(), paths);

    const total = totalFrames(effectiveTiming(rateLimiterSpec), 15);
    expect(result.frames).toBe(total);
    const concat = ff.calls.find((c) => c.includes('concat'));
    expect(concat).toBeDefined();
    const joinedMux = ff.calls.at(-1)!;
    expect(joinedMux.at(-1)).toMatch(/draft\.partial\.mp4$/);
    expect(joinedMux[joinedMux.indexOf('-ss') + 1]).toBe('0');
    expect(joinedMux[joinedMux.indexOf('-t') + 1]).toBe(ffSec(total / 15));
    // No intermediates are left behind.
    expect(readdirSync(dir).sort()).toEqual(['beats', 'draft.json', 'draft.mp4', 'narration.wav']);
  });

  it("muxes each clip with its own narration slice (its span's offsets)", async () => {
    const wav = join(dir, 'narration.wav');
    writeFileSync(wav, makeWav(Array.from({ length: 30_000 }, () => 0)));
    const { tools, ff } = fakeTools();
    await renderDraft(target(rateLimiterSpec, wav), tools, run(), paths);

    const spans = beatFrameSpans(effectiveTiming(rateLimiterSpec), 15);
    const clipMuxes = ff.calls.filter((c) => c.includes(wav) && !c.at(-1)!.includes('/draft.'));
    expect(clipMuxes).toHaveLength(spans.length);
    clipMuxes.forEach((args, i) => {
      const span = spans[i]!;
      expect(Number(args[args.indexOf('-ss') + 1])).toBeCloseTo(span.from / 15, 5);
      expect(Number(args[args.indexOf('-t') + 1])).toBeCloseTo(span.durationInFrames / 15, 5);
    });
  });

  it('reports progress from 0 to 1, never backwards', async () => {
    const { tools } = fakeTools();
    await renderDraft(target(), tools, run(), paths);
    expect(progress.at(-1)).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('stops when the job is aborted', async () => {
    const { tools } = fakeTools();
    const controller = new AbortController();
    controller.abort(new Error('shutting down'));
    await expect(renderDraft(target(), tools, run(controller.signal), paths)).rejects.toThrow(
      'shutting down',
    );
  });
});

describe('renderBeatDraft', () => {
  it('renders one beat, then reuses it while its inputs are unchanged', async () => {
    const { tools, engine } = fakeTools();
    const first = await renderBeatDraft(target(), 'payoff', tools, run(), paths);
    expect(first.rendered).toEqual(['payoff']);
    expect(engine.videos.map((r) => r.inputProps.beatId)).toEqual(['payoff']);
    const again = await renderBeatDraft(target(), 'payoff', tools, run(), paths);
    expect(again.reused).toEqual(['payoff']);
  });

  it('shares its cache with renderDraft', async () => {
    const { tools } = fakeTools();
    await renderBeatDraft(target(), 'payoff', tools, run(), paths);
    const draft = await renderDraft(target(), tools, run(), paths);
    expect(draft.reused).toEqual(['payoff']);
  });

  it('names the beat when it is unknown', async () => {
    const { tools } = fakeTools();
    await expect(renderBeatDraft(target(), 'nope', tools, run(), paths)).rejects.toThrow(
      'Unknown beat "nope".',
    );
  });
});
