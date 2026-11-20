import { beatFrameSpans, beatKeyFrame } from '@explainer-studio/renderer/catalog';
import { effectiveTiming } from '@explainer-studio/shared';
import { withSession } from './engine.ts';
import {
  compositionProps,
  writeAtomically,
  type RenderRun,
  type RenderTarget,
  type RenderTools,
} from './target.ts';

/**
 * One PNG per beat at its key frame (`beatKeyFrame`: the board settled), from `BeatFromSpec` at
 * the draft preset's size, without the draft badge. Returns the frame used per beat.
 */
export async function renderStills(
  target: RenderTarget,
  tools: RenderTools,
  run: RenderRun,
  stillPath: (beatId: string) => string,
): Promise<Record<string, number>> {
  const preset = tools.settings.presets.draft;
  const beatIds = beatFrameSpans(effectiveTiming(target.spec), preset.fps).map((s) => s.beatId);
  const frames: Record<string, number> = {};
  await withSession(tools.engine, async (session) => {
    for (const [i, beatId] of beatIds.entries()) {
      const frame = beatKeyFrame(target.spec, beatId, preset.fps, keyFrameOptions(target));
      await writeAtomically(stillPath(beatId), (out) =>
        session.renderStill({
          compositionId: 'BeatFromSpec',
          inputProps: compositionProps(target, preset, { beatId }),
          preset,
          frame,
          outPath: out,
          signal: run.signal,
        }),
      );
      frames[beatId] = frame;
      run.onProgress((i + 1) / beatIds.length, `still ${beatId}`);
    }
  });
  return frames;
}

function keyFrameOptions(target: RenderTarget) {
  return target.props.themeId ? { themeId: target.props.themeId } : {};
}
