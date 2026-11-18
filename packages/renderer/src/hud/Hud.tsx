import type { EffectiveTiming, RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { rectCss } from '../layers/rect-css.ts';
import type { Theme } from '../theme/index.ts';
import type { BeatFrameSpan } from '../timing/frames.ts';
import { ChapterHeader } from './ChapterHeader.tsx';
import { Headline } from './Headline.tsx';
import { HeroMetricPill, StoryClock } from './HeroMetric.tsx';
import { hudLayout } from './hud-layout.ts';
import {
  activeAt,
  chapterSpans,
  headlineCues,
  storyClockPoints,
  visibleHudParts,
} from './hud-state.ts';
import { StepTracker } from './StepTracker.tsx';
import { TopBar } from './TopBar.tsx';

type Props = {
  theme: Theme;
  spec: RenderableVideoSpec;
  timing: EffectiveTiming;
  spans: readonly BeatFrameSpan[];
  fps: number;
  seriesLabel: string;
  accent: string;
  channelHandle: string | null;
};

/** Pinned parts (pill, clock) enter this long after the first beat starts. */
const PINNED_DELAY_SEC = 0.5;

/** The HUD layer: top bar, step tracker, hero metric, chapter header, story clock, headline. */
export function Hud(props: Props) {
  const { theme, spec, timing, spans, fps, seriesLabel, accent, channelHandle } = props;
  const frame = useCurrentFrame();
  const layout = useMemo(() => hudLayout(theme), [theme]);
  const parts = useMemo(() => visibleHudParts(spec), [spec]);
  const chapters = useMemo(() => chapterSpans(spec, spans), [spec, spans]);
  const cues = useMemo(() => headlineCues(spec, timing, spans, fps), [spec, timing, spans, fps]);
  const metric = spec.story.heroMetric;
  const clock = metric?.storyClock;
  const points = useMemo(() => (clock ? storyClockPoints(clock, timing) : []), [clock, timing]);

  const chapter = activeAt(chapters, frame);
  const cue = activeAt(cues, frame);
  const start = spans[0]?.from ?? 0;
  const pinnedFrom = start + Math.round(PINNED_DELAY_SEC * fps);
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
        />
      ) : null}
      <div style={{ ...rectCss(layout.metaRow), ...row, justifyContent: 'space-between' }}>
        {parts.stepTracker && chapter ? (
          <StepTracker theme={theme} chapters={chapters} current={chapter} accent={accent} />
        ) : (
          <div />
        )}
        {parts.heroMetric && metric ? (
          <HeroMetricPill theme={theme} metric={metric} from={pinnedFrom} />
        ) : null}
      </div>
      <div style={{ ...rectCss(layout.chapterRow), ...row, justifyContent: 'space-between' }}>
        {parts.chapterHeader && chapter ? (
          <ChapterHeader theme={theme} chapter={chapter} accent={accent} />
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
        <Headline key={cue.beatId} theme={theme} rect={layout.headline} cue={cue} />
      ) : null}
    </AbsoluteFill>
  );
}
