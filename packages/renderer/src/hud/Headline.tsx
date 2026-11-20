import { useCurrentFrame, useVideoConfig } from 'remotion';
import { rectCss } from '../layers/rect-css.ts';
import { FocusUnderline } from '../emphasis/Mark.tsx';
import { semanticTint, textCss, type Rect, type Theme } from '../theme/index.ts';
import type { HeadlineCue } from './hud-state.ts';
import { enterProgress } from './motion.ts';
import { HEADLINE_LINES } from './hud-slots.ts';
import { HEADLINE_COLOURS } from './semantic.ts';

type Props = {
  theme: Theme;
  rect: Rect;
  cue: HeadlineCue;
  /** Line width the two-line clamp wraps at (its HUD style's `headline` slot). */
  room: number;
};

/** The beat's big centred definition line, coloured by its semantic; rises in on its anchor. */
export function Headline({ theme, rect, cue, room }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = enterProgress(frame, cue.from, fps);
  const semantic = HEADLINE_COLOURS[cue.semantic];
  const tint = semanticTint(theme, semantic);
  return (
    <div style={{ ...rectCss(rect), display: 'grid', placeItems: 'center' }}>
      <div
        style={{
          ...textCss(theme, 'headline'),
          color: tint.base,
          textAlign: 'center',
          maxWidth: room,
          textShadow: `0 0 ${theme.glow.outerBlur}px ${tint.soft}`,
          display: '-webkit-box',
          WebkitLineClamp: HEADLINE_LINES,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          opacity: progress,
          transform: `translateY(${(1 - progress) * theme.space.md}px) scale(${0.96 + 0.04 * progress})`,
        }}
      >
        <FocusUnderline theme={theme} semantic={semantic} wrap>
          {cue.text}
        </FocusUnderline>
      </div>
    </div>
  );
}
