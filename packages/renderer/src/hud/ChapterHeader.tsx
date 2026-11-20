import { useCurrentFrame, useVideoConfig } from 'remotion';
import { textCss, type Theme } from '../theme/index.ts';
import type { ChapterSpan } from './hud-state.ts';
import { enterProgress, enterStyle } from './motion.ts';
import { ellipsis } from './styles.ts';

type Props = {
  theme: Theme;
  chapter: ChapterSpan;
  accent: string;
  /** Width the line is cut at (its HUD style's slot). */
  room: number;
};

/** "— 2 · CHAPTER QUESTION?" for the current chapter; slides in when the chapter starts. */
export function ChapterHeader({ theme, chapter, accent, room }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = enterProgress(frame, chapter.from, fps);
  return (
    <div
      key={chapter.chapterId}
      style={{
        ...textCss(theme, 'chapter'),
        ...ellipsis,
        ...enterStyle(progress, -theme.space.lg, 'x'),
        // Fills the row up to the slot, as before: a box as wide as the text would clip the last
        // glyph's antialiasing. The neighbour is measured no narrower than it draws, so the
        // slot is what cuts.
        flex: 1,
        maxWidth: room,
        color: theme.colours.ink.primary,
      }}
    >
      <span style={{ color: accent }}>— {chapter.index + 1} · </span>
      {chapter.heading}
    </div>
  );
}
