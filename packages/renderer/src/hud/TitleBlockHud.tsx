import { useMemo } from 'react';
import { AbsoluteFill } from 'remotion';
import { rectCss } from '../layers/rect-css.ts';
import { formatAreas } from '../layout/format.ts';
import { CardViewport } from './CardViewport.tsx';
import { ChapterHeader } from './ChapterHeader.tsx';
import { DimensionMetric } from './DimensionMetric.tsx';
import { StepMarker, StepName } from './StepTracker.tsx';
import { Headline } from './Headline.tsx';
import { StoryClock } from './HeroMetric.tsx';
import { titleBlockSlots } from './hud-slots.ts';
import { titleBlockLayout, viewportLabel, type TitleBlockVariant } from './title-block.ts';
import { TitleBlock } from './TitleBlock.tsx';
import { useHudModel, type HudProps } from './use-hud-model.ts';

type Props = HudProps & { variant: TitleBlockVariant };

/**
 * `hud.style: 'title-block'`. The strip variant draws the title block (topic, SHEET for the step
 * tracker, REV, handle), then the step dots beside the hero metric dimension, then the chapter
 * header (or the current step's name) beside the story clock. The header variant (card format) draws the title
 * block with the title in display type, the same rows under it, and the diagram window as a ruled
 * viewport (`CardViewport`); its headline goes under the window (`formatAreas`).
 */
export function TitleBlockHud({ variant, ...props }: Props) {
  const { theme, spec, seriesLabel, accent, channelHandle } = props;
  const { frame, parts, chapters, chapter, cue, metric, clock, points, start, pinnedFrom } =
    useHudModel(props);
  const layout = useMemo(() => titleBlockLayout(theme, variant), [theme, variant]);
  const areas = useMemo(() => formatAreas(theme, spec.meta.format), [theme, spec.meta.format]);
  const slots = useMemo(() => titleBlockSlots(theme, variant, spec), [theme, variant, spec]);
  const headlineBand = areas.headlineBand;
  const row = { display: 'flex', alignItems: 'center', gap: theme.space.md } as const;
  const showSheet = parts.stepTracker && chapter !== undefined;

  return (
    <AbsoluteFill>
      {variant === 'header' && areas.viewport ? (
        <CardViewport
          theme={theme}
          rect={areas.viewport}
          label={viewportLabel({
            chapterHeader: parts.chapterHeader,
            chapterTitle: chapter?.title,
          })}
          labelKey={parts.chapterHeader && chapter ? chapter.chapterId : 'detail'}
          labelFrom={parts.chapterHeader && chapter ? chapter.from : start}
          labelRoom={slots.viewportLabel}
        />
      ) : null}
      {parts.topBar || variant === 'header' ? (
        <TitleBlock
          theme={theme}
          variant={variant}
          layout={layout}
          seriesLabel={seriesLabel}
          title={spec.meta.title}
          accent={accent}
          channelHandle={channelHandle}
          sheet={showSheet ? { chapters, current: chapter } : null}
          from={start}
          slots={slots}
        />
      ) : null}
      <div style={{ ...rectCss(layout.metaRow), ...row, justifyContent: 'space-between' }}>
        {showSheet ? (
          <StepMarker
            theme={theme}
            chapters={chapters}
            current={chapter}
            accent={accent}
            label={false}
          />
        ) : (
          <div />
        )}
        {parts.heroMetric && metric ? (
          <DimensionMetric theme={theme} metric={metric} from={pinnedFrom} />
        ) : null}
      </div>
      <div style={{ ...rectCss(layout.chapterRow), ...row, justifyContent: 'space-between' }}>
        {parts.chapterHeader && chapter ? (
          <ChapterHeader theme={theme} chapter={chapter} accent={accent} room={slots.chapter} />
        ) : showSheet ? (
          <StepName theme={theme} chapter={chapter} room={slots.chapter} />
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
          rect={headlineBand}
          cue={cue}
          room={slots.headline}
        />
      ) : null}
    </AbsoluteFill>
  );
}
