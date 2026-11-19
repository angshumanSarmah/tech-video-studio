import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { rectCss } from '../layers/rect-css.ts';
import { formatAreas } from '../layout/format.ts';
import { textCss, type Theme } from '../theme/index.ts';
import { CardViewport } from './CardViewport.tsx';
import { ChapterHeader } from './ChapterHeader.tsx';
import { DimensionMetric } from './DimensionMetric.tsx';
import { Headline } from './Headline.tsx';
import { StoryClock } from './HeroMetric.tsx';
import type { ChapterSpan } from './hud-state.ts';
import { enterProgress, enterStyle } from './motion.ts';
import { ellipsis } from './styles.ts';
import { titleBlockLayout, viewportLabel, type TitleBlockVariant } from './title-block.ts';
import { TitleBlock } from './TitleBlock.tsx';
import { useHudModel, type HudProps } from './use-hud-model.ts';

type Props = HudProps & { variant: TitleBlockVariant };

/**
 * `hud.style: 'title-block'`. The strip variant draws the title block (topic, SHEET for the step
 * tracker, REV, handle), then the chapter header or step name beside the hero metric dimension,
 * then the story clock when `spec.hud` has it on. The header variant (card format) draws the title
 * block with the title in display type, the same rows under it, and the diagram window as a ruled
 * viewport (`CardViewport`); its headline goes under the window (`formatAreas`).
 */
export function TitleBlockHud({ variant, ...props }: Props) {
  const { theme, spec, seriesLabel, accent, channelHandle } = props;
  const { frame, parts, chapters, chapter, cue, metric, clock, points, start, pinnedFrom } =
    useHudModel(props);
  const layout = useMemo(() => titleBlockLayout(theme, variant), [theme, variant]);
  const areas = useMemo(() => formatAreas(theme, spec.meta.format), [theme, spec.meta.format]);
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
        />
      ) : null}
      {
        <div style={{ ...rectCss(layout.metaRow), ...row, justifyContent: 'space-between' }}>
          {parts.chapterHeader && chapter ? (
            <ChapterHeader theme={theme} chapter={chapter} accent={accent} />
          ) : showSheet ? (
            <StepName theme={theme} chapter={chapter} />
          ) : (
            <div />
          )}
          {parts.heroMetric && metric ? (
            <DimensionMetric theme={theme} metric={metric} from={pinnedFrom} />
          ) : null}
        </div>
      }
      {parts.storyClock && clock ? (
        <div style={{ ...rectCss(layout.clockRow), ...row, justifyContent: 'flex-end' }}>
          <StoryClock
            theme={theme}
            fromLabel={clock.from}
            toLabel={clock.to}
            points={points}
            from={pinnedFrom}
          />
        </div>
      ) : null}
      {parts.headline && cue && frame < cue.to ? (
        <Headline key={cue.beatId} theme={theme} rect={headlineBand} cue={cue} />
      ) : null}
    </AbsoluteFill>
  );
}

/**
 * The current step's name, which the bar style shows beside "STEP n/N". Drawn only when the
 * chapter header is off, so the chapter is never named twice.
 */
function StepName({ theme, chapter }: { theme: Theme; chapter: ChapterSpan }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = enterProgress(frame, chapter.from, fps);
  return (
    <div
      key={chapter.chapterId}
      style={{
        ...textCss(theme, 'hud'),
        ...ellipsis,
        ...enterStyle(progress, theme.space.sm),
        color: theme.colours.ink.muted,
      }}
    >
      {chapter.title}
    </div>
  );
}
