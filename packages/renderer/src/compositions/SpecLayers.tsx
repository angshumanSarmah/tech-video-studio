import { effectiveTiming } from '@explainer-studio/shared';
import { useMemo } from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { AssetProvider } from '../assets/AssetContext.tsx';
import { assetContext } from '../assets/library.ts';
import { Background } from '../background/Background.tsx';
import { EndingCard } from '../ending/EndingCard.tsx';
import { endingBoardOpacity } from '../ending/ending-dim.ts';
import { endingCue } from '../ending/ending-state.ts';
import { loadThemeFonts } from '../fonts/load-theme-fonts.ts';
import { Hud } from '../hud/Hud.tsx';
import { DraftBadge } from '../layers/DraftBadge.tsx';
import { NarrationAudio } from '../layers/NarrationAudio.tsx';
import { BeatScene } from '../scene/BeatScene.tsx';
import { sceneSpans } from '../events/transitions.ts';
import { Subtitles } from '../subtitles/Subtitles.tsx';
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
 * overlapping transition), HUD, the ending card (the board dims under it), subtitles, the draft
 * badge (drafts only), audio.
 */
export function SpecLayers(props: Props) {
  const { spec, series, audioSrc, channelHandle, themeId, assets, draft, onlyBeatId } = props;
  const theme = getTheme(themeId ?? DEFAULT_THEME_ID);
  loadThemeFonts(theme);
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
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
  const ending = useMemo(
    () => endingCue(spec, timing, fps, series.label),
    [spec, timing, fps, series.label],
  );
  const boardOpacity = endingBoardOpacity(frame, ending?.from, fps);
  return (
    <AssetProvider value={assetValue}>
      <AbsoluteFill>
        <Background theme={theme} />
        <AbsoluteFill style={{ opacity: boardOpacity }}>
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
        </AbsoluteFill>
        <Hud
          theme={theme}
          spec={spec}
          timing={timing}
          spans={spans}
          fps={fps}
          seriesLabel={series.label}
          accent={accent}
          channelHandle={channelHandle}
          {...(ending ? { headlineUntil: ending.from } : {})}
        />
        {ending ? (
          <EndingCard theme={theme} format={spec.meta.format} cue={ending} accent={accent} />
        ) : null}
        <Subtitles theme={theme} spec={spec} timing={timing} accent={accent} />
        {draft ? <DraftBadge theme={theme} /> : null}
        {audioSrc ? <NarrationAudio src={audioSrc} /> : null}
      </AbsoluteFill>
    </AssetProvider>
  );
}
