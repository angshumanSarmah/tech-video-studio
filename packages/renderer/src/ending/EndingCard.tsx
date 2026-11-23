import type { VideoFormat } from '@explainer-studio/shared';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { DrawOutline } from '../draw/DrawReveal.tsx';
import { DrawRule } from '../draw/DrawRule.tsx';
import { drawing } from '../draw/hud-draw.ts';
import { borderOutline } from '../draw/outline.ts';
import { drawLevels, type DrawLevels } from '../events/presets.ts';
import { enterProgress, enterStyle } from '../hud/motion.ts';
import { ellipsis } from '../hud/styles.ts';
import { rectCss } from '../layers/rect-css.ts';
import { textCss, withAlpha, type Theme } from '../theme/index.ts';
import {
  ENDING_SPEC_LABEL,
  ENDING_STYLES,
  endingBox,
  endingRooms,
  type EndingRooms,
  type EndingRow,
} from './ending-layout.ts';
import { ENDING_DRAW_SEC, type EndingContent, type EndingCue } from './ending-state.ts';

type Props = {
  theme: Theme;
  format: VideoFormat;
  cue: EndingCue;
  /** The series accent, adapted to the theme (`seriesAccent`). */
  accent: string;
};

/**
 * The ending card over the board, from its cue to the end of the video. Title-block themes draw
 * a ruled table on the paper surface (drawn on with the pen in `draw` enter style themes: the
 * frame and rules first, then the text); bar themes draw a plain raised card that fades in. Both
 * use the same rows (`endingBox`), so the text checks hold for either.
 */
export function EndingCard({ theme, format, cue, accent }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { box, rows, ctaLines } = useMemo(
    () => endingBox(theme, format, cue.content),
    [theme, format, cue.content],
  );
  const rooms = useMemo(() => endingRooms(theme, format), [theme, format]);
  if (frame < cue.from) return null;
  const ruled = theme.hud.style === 'title-block';
  const draw =
    theme.enter.style === 'draw' ? drawLevels((frame - cue.from) / fps / ENDING_DRAW_SEC) : null;
  const live = draw && drawing(draw) ? draw : undefined;
  const ink = theme.colours.ink.primary;
  const frameColour = ruled ? ink : theme.colours.line;
  const surface = ruled ? theme.colours.surface : theme.colours.surfaceRaised;
  const radius = ruled ? 0 : theme.radius.md;
  return (
    <div
      data-testid="ending-card"
      style={{
        ...rectCss(box),
        ...(draw ? {} : enterStyle(enterProgress(frame, cue.from, fps), theme.space.md)),
        boxSizing: 'border-box',
        border: `${theme.stroke.thin}px solid ${live ? 'transparent' : frameColour}`,
        borderRadius: radius,
        background: live ? withAlpha(surface, live.fill) : surface,
      }}
    >
      {live ? (
        <DrawOutline
          shapes={[borderOutline(box, radius, theme.stroke.thin, frameColour)]}
          stroke={live.stroke}
          box={box}
          border={theme.stroke.thin}
        />
      ) : null}
      {rows.map((row, i) => (
        <Row key={i} theme={theme} row={row} ruled={ruled} draw={live}>
          <RowContent
            theme={theme}
            row={row}
            index={rows.slice(0, i).filter((r) => r.kind === 'line').length}
            content={cue.content}
            rooms={rooms}
            ctaLines={ctaLines}
            accent={accent}
            ruled={ruled}
            draw={live}
          />
        </Row>
      ))}
    </div>
  );
}

type RowProps = {
  theme: Theme;
  row: EndingRow;
  ruled: boolean;
  draw: DrawLevels | undefined;
  children: ReactNode;
};

/** A row at its fixed height, ruled above (except the header) in title-block themes. */
function Row({ theme, row, ruled, draw, children }: RowProps) {
  const rule = row.kind === 'header' ? 0 : theme.stroke.hairline;
  const ink = theme.colours.ink.primary;
  const colour = ruled && !draw ? ink : 'transparent';
  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    top: row.y - theme.stroke.thin,
    height: row.height,
    boxSizing: 'border-box',
    borderTop: rule ? `${rule}px solid ${colour}` : 'none',
    display: 'flex',
  };
  return (
    <div style={style}>
      {ruled && draw && rule ? (
        <DrawRule edge="top" thickness={rule} colour={ink} stroke={draw.stroke} />
      ) : null}
      {children}
    </div>
  );
}

type ContentProps = {
  theme: Theme;
  row: EndingRow;
  /** 0-based position of a line row among the lines. */
  index: number;
  content: EndingContent;
  rooms: EndingRooms;
  ctaLines: number;
  accent: string;
  ruled: boolean;
  draw: DrawLevels | undefined;
};

function RowContent(props: ContentProps) {
  const { theme, row, content, draw } = props;
  const opacity = draw ? draw.fill : 1;
  const pad = `0 ${theme.space.sm}px`;
  const { ink } = theme.colours;
  if (row.kind === 'header') {
    return (
      <div
        style={{
          ...textCss(theme, ENDING_STYLES.header),
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: pad,
          opacity,
        }}
      >
        <span style={{ color: props.accent }}>{content.header}</span>
        {content.lines.length > 0 ? (
          <span style={{ color: ink.muted }}>{ENDING_SPEC_LABEL}</span>
        ) : null}
      </div>
    );
  }
  if (row.kind === 'line') return <LineRow {...props} opacity={opacity} />;
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: pad, opacity }}>
      <div
        style={{
          ...textCss(theme, ENDING_STYLES.cta),
          color: ink.primary,
          maxWidth: props.rooms.cta,
          display: '-webkit-box',
          WebkitLineClamp: props.ctaLines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {content.cta}
      </div>
    </div>
  );
}

/** "1 │ ONE SHARED BUCKET PER KEY": the number cell, ruled on its right, then the line. */
function LineRow({
  theme,
  index,
  content,
  rooms,
  ruled,
  draw,
  opacity,
}: ContentProps & {
  opacity: number;
}) {
  const ink = theme.colours.ink;
  const rule = theme.stroke.hairline;
  const colour = ruled && !draw ? ink.primary : 'transparent';
  return (
    <>
      <div
        style={{
          ...textCss(theme, ENDING_STYLES.number),
          position: 'relative',
          flex: 'none',
          width: rooms.numberWidth,
          boxSizing: 'border-box',
          borderRight: `${rule}px solid ${colour}`,
          display: 'grid',
          placeItems: 'center',
          color: ink.muted,
        }}
      >
        {ruled && draw ? (
          <DrawRule edge="right" thickness={rule} colour={ink.primary} stroke={draw.stroke} />
        ) : null}
        <span style={{ opacity }}>{index + 1}</span>
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${theme.space.sm}px`,
          opacity,
        }}
      >
        <div
          style={{
            ...textCss(theme, ENDING_STYLES.line),
            ...ellipsis,
            maxWidth: rooms.line,
            color: ink.primary,
          }}
        >
          {content.lines[index]}
        </div>
      </div>
    </>
  );
}
