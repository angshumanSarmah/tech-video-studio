import type { CSSProperties, ReactNode } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { markHostCss } from '../emphasis/emphasis.ts';
import { BoxMark } from '../emphasis/Mark.tsx';
import { rectCss } from '../layers/rect-css.ts';
import { textCss, type Theme } from '../theme/index.ts';
import type { ChapterSpan } from './hud-state.ts';
import { enterProgress, enterStyle } from './motion.ts';
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
};

/**
 * A drawing title block: an ink-ruled box of cells on the paper's surface colour. Built from
 * theme tokens only, so it draws in any theme (the card format's header uses the `header` variant).
 */
export function TitleBlock(props: TitleBlockProps) {
  const { theme, variant, layout, title, channelHandle, sheet, from } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ink = theme.colours.ink.primary;
  const cells = titleBlockCells({ variant, sheet: sheet !== null, channelHandle });
  return (
    <div
      style={{
        ...rectCss(layout.block),
        ...enterStyle(enterProgress(frame, from, fps), -theme.space.sm),
        boxSizing: 'border-box',
        border: `${theme.stroke.thin}px solid ${ink}`,
        background: theme.colours.surface,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TopCell theme={theme} height={layout.topHeight}>
        {variant === 'header' ? (
          <TitleText theme={theme} text={title} />
        ) : (
          <SubjectText {...props} />
        )}
      </TopCell>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {cells.map((id, i) => (
          <Cell key={id} theme={theme} grow={i === 0} first={i === 0}>
            <CellContent {...props} id={id} />
          </Cell>
        ))}
      </div>
    </div>
  );
}

type TopCellProps = { theme: Theme; height: number; children: ReactNode };

function TopCell({ theme, height, children }: TopCellProps) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        height,
        flex: 'none',
        padding: `${theme.space.xs}px ${theme.space.sm}px`,
        borderBottom: `${theme.stroke.hairline}px solid ${theme.colours.ink.primary}`,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {children}
    </div>
  );
}

/** The header's title: display type, up to `TITLE_LINES` lines. */
function TitleText({ theme, text }: { theme: Theme; text: string }) {
  return (
    <div
      style={{
        ...textCss(theme, 'title'),
        color: theme.colours.ink.primary,
        display: '-webkit-box',
        WebkitLineClamp: TITLE_LINES,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}
    >
      {text}
    </div>
  );
}

/** The strip's "SERIES · TOPIC" line, truncated when it does not fit. */
function SubjectText({ theme, seriesLabel, title, accent }: TitleBlockProps) {
  return (
    <div style={{ ...textCss(theme, 'hud'), ...ellipsis, color: theme.colours.ink.primary }}>
      <span style={{ color: accent }}>{seriesLabel}</span>
      <span style={{ color: theme.colours.ink.faint }}> · </span>
      {title}
    </div>
  );
}

type CellProps = { theme: Theme; grow: boolean; first: boolean; children: ReactNode };

function Cell({ theme, grow, first, children }: CellProps) {
  const style: CSSProperties = {
    ...textCss(theme, 'hud'),
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${theme.space.sm}px`,
    borderLeft: first ? 'none' : `${theme.stroke.hairline}px solid ${theme.colours.ink.primary}`,
    color: theme.colours.ink.primary,
    ...(grow ? { flex: 1, minWidth: 0 } : { flex: 'none' }),
  };
  return <div style={style}>{children}</div>;
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
