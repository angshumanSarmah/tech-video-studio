import { useCurrentFrame, useVideoConfig } from 'remotion';
import { emphasisShadow, markHostCss } from '../emphasis/emphasis.ts';
import { BoxMark } from '../emphasis/Mark.tsx';
import { textCss, tintFor, type Theme } from '../theme/index.ts';
import type { ChapterSpan } from './hud-state.ts';
import { enterProgress, enterStyle } from './motion.ts';
import { STEP_DOT } from './hud-slots.ts';
import { ellipsis } from './styles.ts';

type Props = {
  theme: Theme;
  chapters: readonly ChapterSpan[];
  current: ChapterSpan;
  accent: string;
  /** Width the "STEP n/N · NAME" line is cut at (`barSlots().stepText`). */
  room: number;
};

/**
 * "STEP 2/3 · NAME" plus one dot per chapter; the current dot fills as its chapter starts. The
 * filled dots carry the theme's emphasis (glow), or in mark themes the current step is marked.
 */
export function StepTracker({ theme, chapters, current, accent, room }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = enterProgress(frame, current.from, fps);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space.sm, flex: 'none' }}>
      <div
        key={current.chapterId}
        style={{
          ...textCss(theme, 'hud'),
          ...ellipsis,
          flex: 'none',
          maxWidth: room,
          ...enterStyle(progress, theme.space.sm),
          color: theme.colours.ink.muted,
        }}
      >
        <span style={{ ...markHostCss(theme), color: theme.colours.ink.primary }}>
          <BoxMark theme={theme} levels={{ highlight: progress }} radius={4} />
          {/* Same text as `stepLabel`, kept as separate nodes so the rendered glyphs do not change. */}
          STEP {current.index + 1}/{chapters.length}
        </span>
        {' · '}
        {current.title}
      </div>
      <div style={{ display: 'flex', gap: theme.space.xs, flex: 'none' }}>
        {chapters.map((chapter) => (
          <Dot
            key={chapter.chapterId}
            theme={theme}
            accent={accent}
            fill={
              chapter.index < current.index ? 1 : chapter.index === current.index ? progress : 0
            }
          />
        ))}
      </div>
    </div>
  );
}

function Dot({ theme, accent, fill }: { theme: Theme; accent: string; fill: number }) {
  const tint = tintFor(theme, accent);
  return (
    <div
      style={{
        width: STEP_DOT,
        height: STEP_DOT,
        borderRadius: theme.radius.pill,
        border: `${theme.stroke.thin}px solid ${fill > 0 ? tint.border : theme.colours.line}`,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        style={{
          width: STEP_DOT,
          height: STEP_DOT,
          borderRadius: theme.radius.pill,
          background: accent,
          boxShadow: emphasisShadow(theme, tint, fill, 0),
          transform: `scale(${fill})`,
        }}
      />
    </div>
  );
}
