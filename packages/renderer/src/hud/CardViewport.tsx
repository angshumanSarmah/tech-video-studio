import { useCurrentFrame, useVideoConfig } from 'remotion';
import { DrawOutline } from '../draw/DrawReveal.tsx';
import { DrawRule } from '../draw/DrawRule.tsx';
import { drawing, hudDraw } from '../draw/hud-draw.ts';
import { borderOutline } from '../draw/outline.ts';
import { rectCss } from '../layers/rect-css.ts';
import { textCss, withAlpha, type Rect, type Theme } from '../theme/index.ts';
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
  /** Width the label is cut at (`titleBlockSlots().viewportLabel`). */
  labelRoom: number;
};

/**
 * The card format's diagram window as a ruled viewport on the drawing sheet: a thin ink border
 * and a label cell in its top-left corner, ruled like the title block's cells. HUD layer, theme
 * tokens only. The board is laid out inside it, below the cell (`viewportBoard`). In `draw` enter
 * style themes the frame and cell rules draw on once from the start of the video (`hudDraw`).
 */
export function CardViewport(props: Props) {
  const { theme, rect, label, labelKey, labelFrom, labelRoom } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ink = theme.colours.ink.primary;
  const draw = hudDraw(theme, frame, fps);
  const live = drawing(draw) ? draw : undefined;
  const rule = `${theme.stroke.thin}px solid ${live ? 'transparent' : ink}`;
  const progress = enterProgress(frame, labelFrom, fps);
  const thin = theme.stroke.thin;
  return (
    <div style={{ ...rectCss(rect), boxSizing: 'border-box', border: rule }}>
      {live ? (
        <DrawOutline
          shapes={[borderOutline(rect, 0, thin, ink)]}
          stroke={live.stroke}
          box={{ width: rect.width, height: rect.height }}
          border={thin}
        />
      ) : null}
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
          background: live ? withAlpha(theme.colours.surface, live.fill) : theme.colours.surface,
        }}
      >
        {live ? (
          <>
            <DrawRule edge="right" thickness={thin} colour={ink} stroke={live.stroke} />
            <DrawRule edge="bottom" thickness={thin} colour={ink} stroke={live.stroke} />
          </>
        ) : null}
        <div
          key={labelKey}
          style={{
            ...textCss(theme, 'hud'),
            ...ellipsis,
            flex: 'none',
            maxWidth: labelRoom,
            ...enterStyle(progress, theme.space.xs),
            ...(live ? { opacity: progress * live.fill } : {}),
            color: ink,
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
