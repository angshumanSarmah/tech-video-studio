import { useMemo } from 'react';
import { AbsoluteFill } from 'remotion';
import { rectCss } from '../layers/rect-css.ts';
import { ChapterHeader } from './ChapterHeader.tsx';
import { Headline } from './Headline.tsx';
import { HeroMetricPill, StoryClock } from './HeroMetric.tsx';
import { hudLayout } from './hud-layout.ts';
import { barSlots } from './hud-slots.ts';
import { StepTracker } from './StepTracker.tsx';
import { TopBar } from './TopBar.tsx';
import { useHudModel, type HudProps } from './use-hud-model.ts';

/** `hud.style: 'bar'`: open top bar, step tracker, hero metric pill, chapter header, story clock. */
export function BarHud(props: HudProps) {
  const { theme, spec, seriesLabel, accent, channelHandle } = props;
  const { frame, parts, chapters, chapter, cue, metric, clock, points, start, pinnedFrom } =
    useHudModel(props);
  const layout = useMemo(() => hudLayout(theme), [theme]);
  const slots = useMemo(
    () => barSlots(theme, spec, { seriesLabel, channelHandle }),
    [theme, spec, seriesLabel, channelHandle],
  );
  const row = { display: 'flex', alignItems: 'center', gap: theme.space.md } as const;

  return (
    <AbsoluteFill>
      {parts.topBar ? (
        <TopBar
          theme={theme}
          rect={layout.topBar}
          seriesLabel={seriesLabel}
          topic={spec.meta.title}
          accent={accent}
          channelHandle={channelHandle}
          from={start}
          room={slots.topic}
        />
      ) : null}
      <div style={{ ...rectCss(layout.metaRow), ...row, justifyContent: 'space-between' }}>
        {parts.stepTracker && chapter ? (
          <StepTracker
            theme={theme}
            chapters={chapters}
            current={chapter}
            accent={accent}
            room={slots.stepText}
          />
        ) : (
          <div />
        )}
        {parts.heroMetric && metric ? (
          <HeroMetricPill theme={theme} metric={metric} from={pinnedFrom} />
        ) : null}
      </div>
      <div style={{ ...rectCss(layout.chapterRow), ...row, justifyContent: 'space-between' }}>
        {parts.chapterHeader && chapter ? (
          <ChapterHeader theme={theme} chapter={chapter} accent={accent} room={slots.chapter} />
        ) : (
          <div />
        )}
        {parts.storyClock && clock ? (
          <StoryClock
            theme={theme}
            fromLabel={clock.from}
            toLabel={clock.to}
            points={points}
            from={pinnedFrom}
          />
        ) : null}
      </div>
      {parts.headline && cue && frame < cue.to ? (
        <Headline
          key={cue.beatId}
          theme={theme}
          rect={layout.headline}
          cue={cue}
          room={slots.headline}
        />
      ) : null}
    </AbsoluteFill>
  );
}
