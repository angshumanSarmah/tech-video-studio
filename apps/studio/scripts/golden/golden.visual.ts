import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { totalFrames } from '@explainer-studio/renderer/catalog';
import {
  fixtureChannelHandle,
  goldenFixtures,
  type GoldenFixture,
} from '@explainer-studio/renderer/fixtures';
import { effectiveTiming, RenderSettingsSchema } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '#core/config.ts';
import { renderDraft } from '#worker/render/draft.ts';
import { probeArgs } from '#worker/render/ffmpeg-args.ts';
import { runFf, runFfmpeg } from '#worker/render/ffmpeg.ts';
import { createRemotionEngine } from '#worker/render/remotion-engine.ts';
import { renderStills } from '#worker/render/stills.ts';
import type { RenderRun, RenderTarget, RenderTools } from '#worker/render/target.ts';
import { parseProbe } from '../media-checks.ts';
import { compareRgba, describeDiff, diffImage } from './image-diff.ts';
import { decodePng, encodePng } from './png.ts';

/**
 * Visual regression over the golden fixtures (P1A.13), through the real render service: a still
 * per beat at its key frame (`renderStills`, draft preset) compared with the saved image in
 * `apps/studio/golden/<fixture>/<beat>.png`, and the whole fixture rendered as a draft video.
 *
 * Run: pnpm --filter @explainer-studio/studio test:visual
 * Refresh the saved images after an intended visual change: UPDATE_GOLDEN=1 (then review the
 * PNG diff in git before committing). Failures write the actual still and a diff image (changed
 * pixels in red) to <DATA_DIR>/visual/<fixture>/.
 *
 * Saved images depend on the machine that rendered them (Chrome's text rasterising differs
 * between macOS and Linux); see docs/TODO.md.
 */

const UPDATE = process.env.UPDATE_GOLDEN === '1';
const GOLDEN_DIR = fileURLToPath(new URL('../../golden', import.meta.url));
const OUT_DIR = join(loadConfig().dataDir, 'visual');

/** Schema defaults, not the local config: the saved images are at the default draft size. */
const settings = RenderSettingsSchema.parse({});
const tools: RenderTools = { engine: createRemotionEngine(), ffmpeg: runFfmpeg, settings };
const run: RenderRun = { signal: new AbortController().signal, onProgress: () => {} };

rmSync(OUT_DIR, { recursive: true, force: true });

describe.each(goldenFixtures.map((f) => [f.spec.meta.id, f] as const))('%s', (id, fixture) => {
  const outDir = join(OUT_DIR, id);
  const goldenDir = join(GOLDEN_DIR, id);
  const beatIds = fixture.spec.story.beats.map((b) => b.id);

  it('renders a still per beat that matches its saved image', async () => {
    const stillPath = (beatId: string) => join(outDir, 'stills', `${beatId}.png`);
    await renderStills(target(fixture), tools, run, {
      still: stillPath,
      manifest: join(outDir, 'stills', 'stills.json'),
    });
    if (UPDATE) {
      updateGolden(goldenDir, beatIds, stillPath);
      return;
    }
    const failures = [...staleGoldens(goldenDir, beatIds)];
    for (const beatId of beatIds) {
      const failure = await compareStill(join(goldenDir, `${beatId}.png`), stillPath(beatId), {
        diffPath: join(outDir, `${beatId}.diff.png`),
        scratch: join(outDir, 'scratch.rgba'),
      });
      if (failure) failures.push(`${beatId}: ${failure}`);
    }
    expect(failures, `actual stills and diffs in ${outDir}`).toEqual([]);
  });

  it('renders as a draft video', async () => {
    const draftDir = join(outDir, 'draft');
    const result = await renderDraft(target(fixture), tools, run, {
      clip: (beatId) => join(draftDir, 'beats', `${beatId}.draft.mp4`),
      meta: (beatId) => join(draftDir, 'beats', `${beatId}.draft.json`),
      joined: join(draftDir, 'draft.mp4'),
    });
    const preset = settings.presets.draft;
    const frames = totalFrames(effectiveTiming(fixture.spec), preset.fps);
    expect(result.rendered).toEqual(beatIds);
    const { video } = parseProbe(await runFf('ffprobe', probeArgs(join(draftDir, 'draft.mp4'))));
    expect(video).toEqual({
      codec: 'h264',
      width: preset.width,
      height: preset.height,
      pixFmt: 'yuv420p',
      fps: `${preset.fps}/1`,
      frames,
    });
  });
});

function target(fixture: GoldenFixture): RenderTarget {
  return {
    spec: fixture.spec,
    props: { series: fixture.series, channelHandle: fixtureChannelHandle },
    audioPath: null,
  };
}

/** Compares one still with its saved image; returns why it fails, or null when it matches. */
async function compareStill(
  goldenPath: string,
  actualPath: string,
  out: { diffPath: string; scratch: string },
): Promise<string | null> {
  if (!existsSync(goldenPath)) return 'no saved image (run with UPDATE_GOLDEN=1)';
  const expected = await decodePng(goldenPath, out.scratch);
  const actual = await decodePng(actualPath, out.scratch);
  const { width, height } = expected.size;
  if (actual.size.width !== width || actual.size.height !== height) {
    return `size ${actual.size.width}x${actual.size.height}, saved ${width}x${height}`;
  }
  const result = compareRgba(expected.rgba, actual.rgba, expected.size);
  if (result.ok) return null;
  await encodePng(diffImage(expected.rgba, result.mask), expected.size, out.diffPath, out.scratch);
  return describeDiff(result);
}

/** Saved images for beats the fixture no longer has. */
function staleGoldens(goldenDir: string, beatIds: readonly string[]): string[] {
  return savedBeats(goldenDir)
    .filter((beatId) => !beatIds.includes(beatId))
    .map((beatId) => `${beatId}: saved image for a beat the fixture no longer has`);
}

/** Replaces the saved images with the rendered stills (and drops ones for removed beats). */
function updateGolden(
  goldenDir: string,
  beatIds: readonly string[],
  stillPath: (beatId: string) => string,
): void {
  mkdirSync(goldenDir, { recursive: true });
  for (const beatId of savedBeats(goldenDir)) {
    if (!beatIds.includes(beatId)) rmSync(join(goldenDir, `${beatId}.png`));
  }
  for (const beatId of beatIds) copyFileSync(stillPath(beatId), join(goldenDir, `${beatId}.png`));
}

function savedBeats(goldenDir: string): string[] {
  if (!existsSync(goldenDir)) return [];
  return readdirSync(goldenDir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => name.slice(0, -'.png'.length));
}
