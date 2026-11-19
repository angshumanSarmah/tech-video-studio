import type { ReactNode } from 'react';
import { textCss, type Theme } from '../theme/index.ts';

/** Badge diameter and the glyph size inside it, in px. */
export const BADGE = 52;
export const BADGE_GLYPH = 30;

/** A smaller badge for small cards (slots, queue blocks), so it never covers a neighbour. */
export const SMALL_BADGE = 36;
export const SMALL_BADGE_GLYPH = 20;

type BadgeProps = {
  theme: Theme;
  colour: string;
  /** 0..1: fades and grows in with its action's progress. */
  opacity: number;
  /** Top-left instead of top-right, so two badges never overlap. */
  left?: boolean;
  /** Top-centre (a role badge), clear of both corner badges. Wins over `left`. */
  centre?: boolean;
  /** Diameter in px; `BADGE` unless the card is small. */
  size?: number;
  children: ReactNode;
};

/** A round badge pinned to a top corner of its (relatively positioned) parent. */
export function Badge({
  theme,
  colour,
  opacity,
  left,
  centre,
  size = BADGE,
  children,
}: BadgeProps) {
  return (
    <div
      style={{
        ...textCss(theme, 'tag'),
        position: 'absolute',
        top: -size / 2,
        ...badgeSide(size, left, centre),
        width: size,
        height: size,
        fontSize: theme.text.tag.size * (size / BADGE),
        borderRadius: theme.radius.pill,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: colour,
        color: theme.colours.background,
        opacity,
        transform: `${centre ? 'translateX(-50%) ' : ''}scale(${0.6 + 0.4 * opacity})`,
      }}
    >
      {children}
    </div>
  );
}

function badgeSide(size: number, left?: boolean, centre?: boolean) {
  if (centre) return { left: '50%' };
  return left ? { left: -size / 2 } : { right: -size / 2 };
}
