import type { HeroMetric as HeroMetricData } from '@explainer-studio/shared';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { FocusUnderline } from '../emphasis/Mark.tsx';
import { semanticTint, textCss, type Theme } from '../theme/index.ts';
import { enterProgress } from './motion.ts';
import { dimensionHeight } from './title-block.ts';

type Props = { theme: Theme; metric: HeroMetricData; from: number };

/**
 * The hero metric as a drawing dimension: "LABEL ├── VALUE ──┤". The extension lines draw out
 * from the value to the end ticks once, then stay.
 */
export function DimensionMetric({ theme, metric, from }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = enterProgress(frame, from, fps);
  const { ink } = theme.colours;
  return (
    <div
      style={{
        ...textCss(theme, 'hud'),
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: theme.space.sm,
        color: ink.muted,
      }}
    >
      <span style={{ opacity: progress }}>{metric.label}</span>
      <div style={{ display: 'flex', alignItems: 'center', height: dimensionHeight(theme) }}>
        <Tick theme={theme} progress={progress} />
        <ExtensionLine theme={theme} progress={progress} towards="left" />
        <span
          style={{
            padding: `0 ${theme.space.xs}px`,
            color: semanticTint(theme, 'focus').base,
            opacity: progress,
          }}
        >
          <FocusUnderline theme={theme} semantic="focus">
            {metric.value}
          </FocusUnderline>
        </span>
        <ExtensionLine theme={theme} progress={progress} towards="right" />
        <Tick theme={theme} progress={progress} />
      </div>
    </div>
  );
}

/** Length of each extension line, value to tick. */
const LINE_SPACE = 'lg';

function ExtensionLine(props: { theme: Theme; progress: number; towards: 'left' | 'right' }) {
  const { theme, progress, towards } = props;
  return (
    <div
      style={{
        width: theme.space[LINE_SPACE],
        height: theme.stroke.thin,
        background: theme.colours.ink.primary,
        transform: `scaleX(${progress})`,
        // Grows out of the value towards its tick.
        transformOrigin: towards === 'left' ? 'right center' : 'left center',
      }}
    />
  );
}

function Tick({ theme, progress }: { theme: Theme; progress: number }) {
  return (
    <div
      style={{
        width: theme.stroke.thin,
        height: '60%',
        background: theme.colours.ink.primary,
        opacity: progress,
      }}
    />
  );
}
