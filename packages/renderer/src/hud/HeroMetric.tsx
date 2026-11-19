import type { HeroMetric as HeroMetricData } from '@explainer-studio/shared';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { FocusUnderline } from '../emphasis/Mark.tsx';
import { semanticTint, textCss, type Theme } from '../theme/index.ts';
import { clockValueAt, formatClock, type ClockPoint } from './hud-state.ts';
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
  fromLabel: string;
  toLabel: string;
  points: readonly ClockPoint[];
  from: number;
};

/** "FROM → TO · 1:52": story time, ticking along the narration track. */
export function StoryClock({ theme, fromLabel, toLabel, points, from }: ClockProps) {
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
      {fromLabel} → {toLabel}
      <span style={{ color: ink.faint }}> · </span>
      <span style={{ color: theme.colours.semantic.focus }}>
        <FocusUnderline theme={theme} semantic="focus">
          {formatClock(clockValueAt(points, frame / fps))}
        </FocusUnderline>
      </span>
    </div>
  );
}
