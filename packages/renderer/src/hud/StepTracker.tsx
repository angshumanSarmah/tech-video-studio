import { useCurrentFrame, useVideoConfig } from 'remotion';
import { emphasisShadow, markHostCss } from '../emphasis/emphasis.ts';
import { BoxMark } from '../emphasis/Mark.tsx';
import { textCss, tintFor, type Theme } from '../theme/index.ts';
import type { ChapterSpan } from './hud-state.ts';
import { enterProgress, enterStyle } from './motion.ts';
import { STEP_DOT, stepLabel } from './hud-slots.ts';
import { ellipsis } from './styles.ts';

type MarkerProps = {
  theme: Theme;
  chapters: readonly ChapterSpan[];
  current: ChapterSpan;
  accent: string;
  /** Draw "STEP n/N" before the dots (the bar style; the title block has its SHEET cell). */
  label: boolean;
};

/**
 * The step tracker's marker: one dot per step (the current dot fills as its chapter starts),
 * after "STEP 2/3" in the bar style. The filled dots carry the theme's emphasis (glow), or in mark
 * themes the step label is marked. The current step's name has its own row (`StepName`).
 */
export function StepMarker({ theme, chapters, current, accent, label }: MarkerProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = enterProgress(frame, current.from, fps);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space.sm, flex: 'none' }}>
      {label ? (
        <div
          key={current.chapterId}
          style={{
            ...textCss(theme, 'hud'),
            flex: 'none',
            ...enterStyle(progress, theme.space.sm),
            color: theme.colours.ink.primary,
          }}
        >
          <span style={markHostCss(theme)}>
            <BoxMark theme={theme} levels={{ highlight: progress }} radius={4} />
            {stepLabel(current.index, chapters.length)}
          </span>
        </div>
      ) : null}
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

/**
 * The current step's name, alone on its row but for the story clock (`barSlots().chapter`,
 * `titleBlockSlots().stepName`). Drawn only when the chapter header is off, so the chapter is
 * never named twice.
 */
export function StepName(props: { theme: Theme; chapter: ChapterSpan; room: number }) {
  const { theme, chapter, room } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = enterProgress(frame, chapter.from, fps);
  return (
    <div
      key={chapter.chapterId}
      style={{
        ...textCss(theme, 'hud'),
        ...ellipsis,
        flex: 'none',
        maxWidth: room,
        ...enterStyle(progress, theme.space.sm),
        color: theme.colours.ink.muted,
      }}
    >
      {chapter.title}
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
