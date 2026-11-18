import { useCurrentFrame, useVideoConfig } from 'remotion';
import { rectCss } from '../layers/rect-css.ts';
import { textCss, type Rect, type Theme } from '../theme/index.ts';
import { enterProgress, enterStyle } from './motion.ts';
import { ellipsis } from './styles.ts';

type Props = {
  theme: Theme;
  rect: Rect;
  seriesLabel: string;
  topic: string;
  accent: string;
  channelHandle: string | null;
  /** First beat start (frame). */
  from: number;
};

/** "SERIES · TOPIC" in the series accent on the left, the channel handle on the right. */
export function TopBar({ theme, rect, seriesLabel, topic, accent, channelHandle, from }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { ink } = theme.colours;
  const label = textCss(theme, 'hud');
  return (
    <div
      style={{
        ...rectCss(rect),
        ...enterStyle(enterProgress(frame, from, fps), -theme.space.sm),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.space.md,
      }}
    >
      <div style={{ ...label, ...ellipsis, color: ink.primary }}>
        <span style={{ color: accent }}>{seriesLabel}</span>
        <span style={{ color: ink.faint }}> · </span>
        {topic}
      </div>
      {channelHandle ? (
        <div style={{ ...label, flex: 'none', color: ink.muted, textTransform: 'none' }}>
          {channelHandle}
        </div>
      ) : null}
    </div>
  );
}
