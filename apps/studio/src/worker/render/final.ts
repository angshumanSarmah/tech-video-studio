import { rmSync } from 'node:fs';
import { totalFrames } from '@explainer-studio/renderer/catalog';
import { effectiveTiming } from '@explainer-studio/shared';
import { mux } from './draft.ts';
import { withSession } from './engine.ts';
import { manifestPathFor, writeManifest, type FinalManifest } from './manifests.ts';
import { writeSubtitles } from './srt.ts';
import {
  compositionProps,
  siblingPath,
  writeAtomically,
  type RenderRun,
  type RenderTarget,
  type RenderTools,
} from './target.ts';

/** Share of the final's progress spent rendering frames; the rest is the audio mux. */
const RENDER_SHARE = 0.97;

/** Where a final render writes: the video and its subtitles (the sidecar sits beside the video). */
export type FinalPaths = { video: string; subtitles: string };

export type FinalResult = { frames: number; durationSec: number; cues: number };

/**
 * One full pass of `VideoFromSpec` at the final preset (cross-beat transitions play as
 * designed), then the whole narration laid under it from 0 s: H.264 yuv420p from Remotion, AAC
 * 48 kHz and `+faststart` from the mux. The SRT holds the same cues the video burns in. A
 * sidecar (`<name>.json`) records the spec version. Every file is written atomically.
 */
export async function renderFinal(
  target: RenderTarget,
  tools: RenderTools,
  run: RenderRun,
  paths: FinalPaths,
): Promise<FinalResult> {
  const outPath = paths.video;
  const preset = tools.settings.presets.final;
  const frames = totalFrames(effectiveTiming(target.spec), preset.fps);
  const silent = siblingPath(outPath, 'video');
  try {
    await withSession(tools.engine, (session) =>
      writeAtomically(silent, async (out) => {
        await session.renderVideo({
          compositionId: 'VideoFromSpec',
          inputProps: compositionProps(target, preset),
          preset,
          mode: 'final',
          concurrency: tools.settings.concurrency,
          outPath: out,
          signal: run.signal,
          onProgress: (f) => run.onProgress(f * RENDER_SHARE, 'rendering'),
        });
      }),
    );
    run.onProgress(RENDER_SHARE, 'muxing narration');
    const audio = target.audioPath ? { path: target.audioPath, startSec: 0 } : null;
    await mux(tools, run, { videoPath: silent, audio, durationSec: frames / preset.fps, outPath });
  } finally {
    rmSync(silent, { force: true });
  }
  const cues = await writeSubtitles(target, paths.subtitles);
  const manifest: FinalManifest = { source: target.source ?? null, fps: preset.fps, frames };
  writeManifest(manifestPathFor(outPath), manifest);
  run.onProgress(1);
  return { frames, durationSec: frames / preset.fps, cues };
}
