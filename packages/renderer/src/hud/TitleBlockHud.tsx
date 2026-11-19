import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { rectCss } from '../layers/rect-css.ts';
import { safeAreas, textCss, type Theme } from '../theme/index.ts';
import { ChapterHeader } from './ChapterHeader.tsx';
import { DimensionMetric } from './DimensionMetric.tsx';
import { Headline } from './Headline.tsx';
import { StoryClock } from './HeroMetric.tsx';
import type { ChapterSpan } from './hud-state.ts';
import { enterProgress, enterStyle } from './motion.ts';
import { ellipsis } from './styles.ts';
import { titleBlockLayout, type TitleBlockVariant } from './title-block.ts';
import { TitleBlock } from './TitleBlock.tsx';
import { useHudModel, type HudProps } from './use-hud-model.ts';

type Props = HudProps & { variant: TitleBlockVariant };

/**
 * `hud.style: 'title-block'`. The strip variant draws the title block (topic, SHEET for the step
 * tracker, REV, handle), then the chapter header or step name beside the hero metric dimension,
 * then the story clock when `spec.hud` has it on. The header variant (card format) draws only
 * the block; P1A.9 places the rest.
 */
export function TitleBlockHud({ variant, ...props }: Props) {
  const { theme, spec, seriesLabel, accent, channelHandle } = props;
  const { frame, parts, chapters, chapter, cue, metric, clock, points, start, pinnedFrom } =
    useHudModel(props);
  const layout = useMemo(() => titleBlockLayout(theme, variant), [theme, variant]);
  const headlineBand = useMemo(() => safeAreas(theme).headlineBand, [theme]);
  const row = { display: 'flex', alignItems: 'center', gap: theme.space.md } as const;
  const showSheet = parts.stepTracker && chapter !== undefined;

  return (
    <AbsoluteFill>
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
      {layout.metaRow ? (
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
      ) : null}
      {layout.clockRow && parts.storyClock && clock ? (
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
