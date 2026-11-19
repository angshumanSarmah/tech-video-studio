import { useCurrentFrame, useVideoConfig } from 'remotion';
import { rectCss } from '../layers/rect-css.ts';
import { textCss, type Rect, type Theme } from '../theme/index.ts';
import { enterProgress, enterStyle } from './motion.ts';
import { ellipsis } from './styles.ts';
import { cellHeight } from './title-block.ts';

type Props = {
  theme: Theme;
  /** The diagram window (`formatAreas(theme, 'card').viewport`). */
  rect: Rect;
  label: string;
  /** Key of what the label names (the chapter id), so a new label fades in. */
  labelKey: string;
  /** Frame the current label appeared at. */
  labelFrom: number;
};

/**
 * The card format's diagram window as a ruled viewport on the drawing sheet: a thin ink border
 * and a label cell in its top-left corner, ruled like the title block's cells. HUD layer, theme
 * tokens only. The board is laid out inside it, below the cell (`viewportBoard`).
 */
export function CardViewport({ theme, rect, label, labelKey, labelFrom }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rule = `${theme.stroke.thin}px solid ${theme.colours.ink.primary}`;
  const progress = enterProgress(frame, labelFrom, fps);
  return (
    <div style={{ ...rectCss(rect), boxSizing: 'border-box', border: rule }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: cellHeight(theme),
          maxWidth: rect.width / 2,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${theme.space.sm}px`,
          borderRight: rule,
          borderBottom: rule,
          background: theme.colours.surface,
        }}
      >
        <div
          key={labelKey}
          style={{
            ...textCss(theme, 'hud'),
            ...ellipsis,
            ...enterStyle(progress, theme.space.xs),
            color: theme.colours.ink.primary,
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
