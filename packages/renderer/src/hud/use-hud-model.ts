import type { EffectiveTiming, RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo } from 'react';
import { useCurrentFrame } from 'remotion';
import type { Theme } from '../theme/index.ts';
import type { BeatFrameSpan } from '../timing/frames.ts';
import {
  activeAt,
  chapterSpans,
  cuesUntil,
  headlineCues,
  storyClockPoints,
  visibleHudParts,
} from './hud-state.ts';

export type HudProps = {
  theme: Theme;
  spec: RenderableVideoSpec;
  timing: EffectiveTiming;
  spans: readonly BeatFrameSpan[];
  fps: number;
  seriesLabel: string;
  accent: string;
  channelHandle: string | null;
  /** Frame the ending card enters at: the headline stops there (it is covered by the card). */
  headlineUntil?: number;
};

/** Pinned parts (pill, clock) enter this long after the first beat starts. */
const PINNED_DELAY_SEC = 0.5;

/** What every HUD style shows at the current frame (style-independent). */
export function useHudModel({ spec, timing, spans, fps, headlineUntil }: HudProps) {
  const frame = useCurrentFrame();
  const parts = useMemo(() => visibleHudParts(spec), [spec]);
  const chapters = useMemo(() => chapterSpans(spec, spans), [spec, spans]);
  const cues = useMemo(
    () => cuesUntil(headlineCues(spec, timing, spans, fps), headlineUntil),
    [spec, timing, spans, fps, headlineUntil],
  );
  const metric = spec.story.heroMetric;
  const clock = metric?.storyClock;
  const points = useMemo(() => (clock ? storyClockPoints(clock, timing) : []), [clock, timing]);
  const start = spans[0]?.from ?? 0;
  return {
    frame,
    parts,
    chapters,
    chapter: activeAt(chapters, frame),
    cue: activeAt(cues, frame),
    metric,
    clock,
    points,
    start,
    pinnedFrom: start + Math.round(PINNED_DELAY_SEC * fps),
  };
}

export type HudModel = ReturnType<typeof useHudModel>;
