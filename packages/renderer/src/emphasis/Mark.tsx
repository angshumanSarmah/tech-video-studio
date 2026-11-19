import { useId } from 'react';
import type { Point } from '../primitives/geometry.ts';
import type { Theme } from '../theme/index.ts';
import {
  MARK_ANGLE_DEG,
  MARK_OVERHANG,
  MARK_RADIUS,
  markFill,
  markView,
  type MarkLevels,
} from './emphasis.ts';

/**
 * Emphasis marks for `mark` themes (see `emphasis.ts`). Each renders nothing in glow themes, so
 * adding one to a component never changes a glow theme's output.
 */

type BoxMarkProps = {
  theme: Theme;
  levels: MarkLevels;
  /** Corner radius of the swipe; `'round'` for circular elements. Defaults to `MARK_RADIUS`. */
  radius?: number | 'round';
};

/**
 * A highlighter swipe behind a box element, overhanging it by `MARK_OVERHANG`, plus the pulse
 * ripple. Place it as the first child of an element styled with `markHostCss`.
 */
export function BoxMark({ theme, levels, radius = MARK_RADIUS }: BoxMarkProps) {
  const view = markView(theme, levels);
  if (!view) return null;
  const corner = (extra: number) => (radius === 'round' ? '50%' : radius + extra);
  return (
    <>
      {view.swipe > 0 ? (
        <div
          style={{
            position: 'absolute',
            inset: -MARK_OVERHANG,
            zIndex: -1,
            borderRadius: corner(0),
            background: markFill(theme),
            opacity: view.swipe,
            transform: `rotate(${MARK_ANGLE_DEG}deg)`,
          }}
        />
      ) : null}
      {view.ripple ? (
        <div
          style={{
            position: 'absolute',
            inset: -(MARK_OVERHANG + view.ripple.spread),
            zIndex: -1,
            borderRadius: corner(view.ripple.spread),
            border: `${theme.stroke.thin}px solid ${theme.colours.ink.primary}`,
            opacity: view.ripple.opacity,
          }}
        />
      ) : null}
    </>
  );
}

type LineMarkProps = { theme: Theme; levels: MarkLevels; d: string; width: number };

/**
 * A wide translucent swipe band under an SVG line (path `d`, stroke `width`), plus the pulse
 * ripple: a thin ink outline of the band that spreads and fades. Draw it before the line.
 */
export function LineMark({ theme, levels, d, width }: LineMarkProps) {
  const maskId = `mark-${useId().replace(/[^\w-]/g, '')}`;
  const view = markView(theme, levels);
  if (!view) return null;
  const band = width + 2 * MARK_OVERHANG;
  const ripple = view.ripple;
  const outer = ripple ? band + 2 * ripple.spread : 0;
  return (
    <g>
      {view.swipe > 0 ? (
        <path
          d={d}
          fill="none"
          stroke={markFill(theme)}
          strokeWidth={band}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={view.swipe}
        />
      ) : null}
      {ripple ? (
        <>
          {/* Hollow outline: the wide stroke minus a slightly narrower one. */}
          <mask id={maskId} maskUnits="userSpaceOnUse" x="-50%" y="-50%" width="200%" height="200%">
            <rect x="-50%" y="-50%" width="200%" height="200%" fill="white" />
            <path
              d={d}
              fill="none"
              stroke="black"
              strokeWidth={outer - 2 * theme.stroke.thin}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </mask>
          <path
            d={d}
            fill="none"
            stroke={theme.colours.ink.primary}
            strokeWidth={outer}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={ripple.opacity}
            mask={`url(#${maskId})`}
          />
        </>
      ) : null}
    </g>
  );
}

type PointMarkProps = { theme: Theme; levels: MarkLevels; at: Point; r: number };

/** A round swipe behind an SVG marker of radius `r` (a route stop), plus the pulse ripple. */
export function PointMark({ theme, levels, at, r }: PointMarkProps) {
  const view = markView(theme, levels);
  if (!view) return null;
  const swipe = r + MARK_OVERHANG;
  return (
    <g>
      {view.swipe > 0 ? (
        <circle cx={at.x} cy={at.y} r={swipe} fill={markFill(theme)} opacity={view.swipe} />
      ) : null}
      {view.ripple ? (
        <circle
          cx={at.x}
          cy={at.y}
          r={swipe + view.ripple.spread}
          fill="none"
          stroke={theme.colours.ink.primary}
          strokeWidth={theme.stroke.thin}
          opacity={view.ripple.opacity}
        />
      ) : null}
    </g>
  );
}
