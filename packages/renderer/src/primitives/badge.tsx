import type { ReactNode } from 'react';
import { textCss, type Theme } from '../theme/index.ts';

/** Badge diameter and the glyph size inside it, in px. */
export const BADGE = 52;
export const BADGE_GLYPH = 30;

type BadgeProps = {
  theme: Theme;
  colour: string;
  /** 0..1: fades and grows in with its action's progress. */
  opacity: number;
  /** Top-left instead of top-right, so two badges never overlap. */
  left?: boolean;
  children: ReactNode;
};

/** A round badge pinned to a top corner of its (relatively positioned) parent. */
export function Badge({ theme, colour, opacity, left, children }: BadgeProps) {
  return (
    <div
      style={{
        ...textCss(theme, 'tag'),
        position: 'absolute',
        top: -BADGE / 2,
        ...(left ? { left: -BADGE / 2 } : { right: -BADGE / 2 }),
        width: BADGE,
        height: BADGE,
        borderRadius: theme.radius.pill,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: colour,
        color: theme.colours.background,
        opacity,
        transform: `scale(${0.6 + 0.4 * opacity})`,
      }}
    >
      {children}
    </div>
  );
}
