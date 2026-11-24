import type {
  HeroMetric as HeroMetricData,
  StoryClock as StoryClockData,
} from '@explainer-studio/shared';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { FocusUnderline } from '../emphasis/Mark.tsx';
import { semanticTint, textCss, type Theme } from '../theme/index.ts';
import { clockValueAt, formatClockValue, type ClockPoint } from './hud-state.ts';
import { enterProgress } from './motion.ts';

type PillProps = { theme: Theme; metric: HeroMetricData; from: number };

/** The pinned pill, e.g. "IPHONE 17 · 3.5 MIN"; pops in once and stays. */
export function HeroMetricPill({ theme, metric, from }: PillProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = enterProgress(frame, from, fps);
  const tint = semanticTint(theme, 'focus');
  return (
    <div
      style={{
        ...textCss(theme, 'hud'),
        flex: 'none',
        padding: `${theme.space.xs}px ${theme.space.md}px`,
        borderRadius: theme.radius.pill,
        border: `${theme.stroke.thin}px solid ${tint.border}`,
        background: tint.soft,
        color: theme.colours.ink.primary,
        opacity: progress,
        transform: `scale(${0.85 + 0.15 * progress})`,
        transformOrigin: 'right center',
      }}
    >
      {metric.label}
      <span style={{ color: theme.colours.ink.faint }}> · </span>
      <span style={{ color: tint.base }}>
        <FocusUnderline theme={theme} semantic="focus">
          {metric.value}
        </FocusUnderline>
      </span>
    </div>
  );
}

type ClockProps = {
  theme: Theme;
  clock: StoryClockData;
  points: readonly ClockPoint[];
  from: number;
};

/** "FROM → TO · 1:52": story time (or a count), running along the narration track. */
export function StoryClock({ theme, clock, points, from }: ClockProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = enterProgress(frame, from, fps);
  const { ink } = theme.colours;
  return (
    <div
      style={{
        ...textCss(theme, 'hud'),
        flex: 'none',
        color: ink.muted,
        fontVariantNumeric: 'tabular-nums',
        opacity: progress,
      }}
    >
      {clock.from} → {clock.to}
      <span style={{ color: ink.faint }}> · </span>
      <span style={{ color: theme.colours.semantic.focus }}>
        <FocusUnderline theme={theme} semantic="focus">
          {formatClockValue(clock, clockValueAt(points, frame / fps), theme.numberLocale)}
        </FocusUnderline>
      </span>
    </div>
  );
}
