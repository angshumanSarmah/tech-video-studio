import { effectiveTiming } from '@explainer-studio/shared';
import { useMemo } from 'react';
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import { AssetProvider } from '../assets/AssetContext.tsx';
import { assetContext } from '../assets/library.ts';
import { Background } from '../background/Background.tsx';
import { DevSubtitles } from '../dev/DevSubtitles.tsx';
import { loadThemeFonts } from '../fonts/load-theme-fonts.ts';
import { Hud } from '../hud/Hud.tsx';
import { NarrationAudio } from '../layers/NarrationAudio.tsx';
import { BeatScene } from '../scene/BeatScene.tsx';
import { sceneSpans } from '../events/transitions.ts';
import { DEFAULT_THEME_ID, getTheme, seriesAccent } from '../theme/index.ts';
import { beatFrameSpans } from '../timing/frames.ts';
import type { VideoFromSpecProps } from './props.ts';

type Props = Omit<VideoFromSpecProps, 'fps'> & {
  /**
   * Render only this beat's scene (HUD, subtitles and audio stay global). Beat transitions are
   * then shown as cuts: the previous board is not drawn.
   */
  onlyBeatId?: string;
};

/**
 * Every layer of a spec on the global timeline (frame 0 = start of the narration track):
 * background, one scene per beat in a `<Sequence>` (an outgoing scene runs on under an
 * overlapping transition), HUD, subtitles, audio.
 */
export function SpecLayers(props: Props) {
  const { spec, series, audioSrc, channelHandle, themeId, assets, onlyBeatId } = props;
  const theme = getTheme(themeId ?? DEFAULT_THEME_ID);
  loadThemeFonts(theme);
  const { fps } = useVideoConfig();
  const timing = useMemo(() => effectiveTiming(spec), [spec]);
  const spans = useMemo(() => beatFrameSpans(timing, fps), [timing, fps]);
  const scenes = useMemo(
    () => sceneSpans(spans, spec.scenes, fps, { cuts: onlyBeatId !== undefined }),
    [spans, spec.scenes, fps, onlyBeatId],
  );
  // Every accent use (top bar, step tracker, chapter number, subtitles) gets the adapted colour.
  const accent = seriesAccent(theme, series.accentColour);
  const shown = onlyBeatId ? scenes.filter((s) => s.beatId === onlyBeatId) : scenes;
  const assetValue = useMemo(() => assetContext(spec.logos, assets), [spec.logos, assets]);
  return (
    <AssetProvider value={assetValue}>
      <AbsoluteFill>
        <Background theme={theme} />
        {shown.map((span) => (
          <Sequence
            key={span.beatId}
            name={`Beat ${span.beatId}`}
            from={span.from}
            durationInFrames={span.durationInFrames}
          >
            <BeatScene
              theme={theme}
              spec={spec}
              timing={timing}
              beatId={span.beatId}
              beatFrom={span.from}
              transitions={span.transitions}
            />
          </Sequence>
        ))}
        <Hud
          theme={theme}
          spec={spec}
          timing={timing}
          spans={spans}
          fps={fps}
          seriesLabel={series.label}
          accent={accent}
          channelHandle={channelHandle}
        />
        <DevSubtitles theme={theme} spec={spec} timing={timing} spans={spans} accent={accent} />
        {audioSrc ? <NarrationAudio src={audioSrc} /> : null}
      </AbsoluteFill>
    </AssetProvider>
  );
}
