import { useCurrentFrame, useVideoConfig } from 'remotion';
import { textCss, tintFor, type Theme } from '../theme/index.ts';
import type { ChapterSpan } from './hud-state.ts';
import { enterProgress, enterStyle } from './motion.ts';
import { ellipsis } from './styles.ts';

type Props = {
  theme: Theme;
  chapters: readonly ChapterSpan[];
  current: ChapterSpan;
  accent: string;
};

/** "STEP 2/3 · NAME" plus one dot per chapter; the current dot fills as its chapter starts. */
export function StepTracker({ theme, chapters, current, accent }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = enterProgress(frame, current.from, fps);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space.sm, minWidth: 0 }}>
      <div
        key={current.chapterId}
        style={{
          ...textCss(theme, 'hud'),
          ...ellipsis,
          ...enterStyle(progress, theme.space.sm),
          color: theme.colours.ink.muted,
        }}
      >
        <span style={{ color: theme.colours.ink.primary }}>
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

const DOT = 14;

function Dot({ theme, accent, fill }: { theme: Theme; accent: string; fill: number }) {
  const tint = tintFor(theme, accent);
  return (
    <div
      style={{
        width: DOT,
        height: DOT,
        borderRadius: theme.radius.pill,
        border: `${theme.stroke.thin}px solid ${fill > 0 ? tint.border : theme.colours.line}`,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        style={{
          width: DOT,
          height: DOT,
          borderRadius: theme.radius.pill,
          background: accent,
          boxShadow: fill > 0 ? tint.glowShadow : 'none',
          transform: `scale(${fill})`,
        }}
      />
    </div>
  );
}
