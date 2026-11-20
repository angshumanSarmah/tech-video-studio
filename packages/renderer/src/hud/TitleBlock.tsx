import type { CSSProperties, ReactNode } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { markHostCss } from '../emphasis/emphasis.ts';
import { BoxMark } from '../emphasis/Mark.tsx';
import { DrawOutline } from '../draw/DrawReveal.tsx';
import { DrawRule } from '../draw/DrawRule.tsx';
import { drawing, hudDraw } from '../draw/hud-draw.ts';
import { borderOutline } from '../draw/outline.ts';
import type { DrawLevels } from '../events/presets.ts';
import { rectCss } from '../layers/rect-css.ts';
import { textCss, withAlpha, type Theme } from '../theme/index.ts';
import type { ChapterSpan } from './hud-state.ts';
import { enterProgress, enterStyle } from './motion.ts';
import type { TitleBlockSlots } from './hud-slots.ts';
import { ellipsis } from './styles.ts';
import {
  REVISION_LABEL,
  sheetLabel,
  TITLE_LINES,
  titleBlockCells,
  type TitleBlockCellId,
  type TitleBlockLayout,
  type TitleBlockVariant,
} from './title-block.ts';

export type TitleBlockSheet = { chapters: readonly ChapterSpan[]; current: ChapterSpan };

export type TitleBlockProps = {
  theme: Theme;
  variant: TitleBlockVariant;
  layout: TitleBlockLayout;
  seriesLabel: string;
  /** The video title (`meta.title`): the subject cell's topic, or the header's title line. */
  title: string;
  accent: string;
  channelHandle: string | null;
  /** The current chapter as SHEET n/N (the step tracker); null hides the cell. */
  sheet: TitleBlockSheet | null;
  /** First beat start (frame): the block slides in. */
  from: number;
  /** Widths the subject line and the title are cut at (`titleBlockSlots`). */
  slots: Pick<TitleBlockSlots, 'subject' | 'title'>;
};

/**
 * A drawing title block: an ink-ruled box of cells on the paper's surface colour. Built from
 * theme tokens only, so it draws in any theme (the card format's header uses the `header` variant).
 * In `draw` enter style themes it draws on once from the start of the video (`hudDraw`): the box
 * and rules first, then the surface and text; elsewhere it slides in at `from`.
 */
export function TitleBlock(props: TitleBlockProps) {
  const { theme, variant, layout, title, channelHandle, sheet, from } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ink = theme.colours.ink.primary;
  const cells = titleBlockCells({ variant, sheet: sheet !== null, channelHandle });
  const draws = theme.enter.style === 'draw';
  const draw = hudDraw(theme, frame, fps);
  const live = drawing(draw) ? draw : undefined;
  return (
    <div
      style={{
        ...rectCss(layout.block),
        ...(draws ? {} : enterStyle(enterProgress(frame, from, fps), -theme.space.sm)),
        boxSizing: 'border-box',
        border: `${theme.stroke.thin}px solid ${live ? 'transparent' : ink}`,
        background: live ? withAlpha(theme.colours.surface, live.fill) : theme.colours.surface,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {live ? (
        <DrawOutline
          shapes={[borderOutline(layout.block, 0, theme.stroke.thin, ink)]}
          stroke={live.stroke}
          box={{ width: layout.block.width, height: layout.block.height }}
          border={theme.stroke.thin}
        />
      ) : null}
      <TopCell theme={theme} height={layout.topHeight} draw={live}>
        {variant === 'header' ? (
          <TitleText theme={theme} text={title} room={props.slots.title} />
        ) : (
          <SubjectText {...props} />
        )}
      </TopCell>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {cells.map((id, i) => (
          <Cell key={id} theme={theme} grow={i === 0} first={i === 0} draw={live}>
            <CellContent {...props} id={id} />
          </Cell>
        ))}
      </div>
    </div>
  );
}

type TopCellProps = {
  theme: Theme;
  height: number;
  /** The title block's draw while it plays; undefined once drawn. */
  draw: DrawLevels | undefined;
  children: ReactNode;
};

function TopCell({ theme, height, draw, children }: TopCellProps) {
  const ink = theme.colours.ink.primary;
  return (
    <div
      style={{
        boxSizing: 'border-box',
        height,
        flex: 'none',
        padding: `${theme.space.xs}px ${theme.space.sm}px`,
        borderBottom: `${theme.stroke.hairline}px solid ${draw ? 'transparent' : ink}`,
        display: 'flex',
        alignItems: 'center',
        ...(draw ? { position: 'relative' } : {}),
      }}
    >
      {draw ? (
        <>
          <DrawRule
            edge="bottom"
            thickness={theme.stroke.hairline}
            colour={ink}
            stroke={draw.stroke}
          />
          <div style={{ opacity: draw.fill, minWidth: 0, display: 'flex' }}>{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}

/** The header's title: display type, up to `TITLE_LINES` lines. */
function TitleText({ theme, text, room }: { theme: Theme; text: string; room: number }) {
  return (
    <div
      style={{
        ...textCss(theme, 'title'),
        color: theme.colours.ink.primary,
        display: '-webkit-box',
        WebkitLineClamp: TITLE_LINES,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        maxWidth: room,
      }}
    >
      {text}
    </div>
  );
}

/** The strip's "SERIES · TOPIC" line, truncated when it does not fit. */
function SubjectText({ theme, seriesLabel, title, accent, slots }: TitleBlockProps) {
  const style = { ...textCss(theme, 'hud'), ...ellipsis, flex: 'none', maxWidth: slots.subject };
  return (
    <div style={{ ...style, color: theme.colours.ink.primary }}>
      <span style={{ color: accent }}>{seriesLabel}</span>
      <span style={{ color: theme.colours.ink.faint }}> · </span>
      {title}
    </div>
  );
}

type CellProps = {
  theme: Theme;
  grow: boolean;
  first: boolean;
  /** The title block's draw while it plays; undefined once drawn. */
  draw: DrawLevels | undefined;
  children: ReactNode;
};

function Cell({ theme, grow, first, draw, children }: CellProps) {
  const ink = theme.colours.ink.primary;
  const style: CSSProperties = {
    ...textCss(theme, 'hud'),
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${theme.space.sm}px`,
    borderLeft: first ? 'none' : `${theme.stroke.hairline}px solid ${draw ? 'transparent' : ink}`,
    color: ink,
    ...(grow ? { flex: 1, minWidth: 0 } : { flex: 'none' }),
    ...(draw ? { position: 'relative' } : {}),
  };
  if (!draw) return <div style={style}>{children}</div>;
  return (
    <div style={style}>
      {first ? null : (
        <DrawRule edge="left" thickness={theme.stroke.hairline} colour={ink} stroke={draw.stroke} />
      )}
      <div style={{ opacity: draw.fill, minWidth: 0, display: 'flex' }}>{children}</div>
    </div>
  );
}

function CellContent(props: TitleBlockProps & { id: TitleBlockCellId }) {
  const { theme, id, seriesLabel, accent, channelHandle, sheet } = props;
  const { ink } = theme.colours;
  switch (id) {
    case 'series':
      return <div style={{ ...ellipsis, color: accent }}>{seriesLabel}</div>;
    case 'sheet':
      return sheet ? <SheetValue theme={theme} sheet={sheet} /> : null;
    case 'revision':
      return <span style={{ color: ink.muted }}>{REVISION_LABEL}</span>;
    case 'handle':
      return <span style={{ color: ink.muted, textTransform: 'none' }}>{channelHandle}</span>;
  }
}

/** "SHEET 2/3": slides in and is marked as its chapter starts, like the step tracker. */
function SheetValue({ theme, sheet }: { theme: Theme; sheet: TitleBlockSheet }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { current, chapters } = sheet;
  const progress = enterProgress(frame, current.from, fps);
  return (
    <span
      key={current.chapterId}
      style={{
        ...markHostCss(theme),
        ...enterStyle(progress, theme.space.sm),
        display: 'inline-block',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <BoxMark theme={theme} levels={{ highlight: progress }} radius={4} />
      {sheetLabel(current.index, chapters.length)}
    </span>
  );
}
