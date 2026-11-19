import { useId, type ReactNode } from 'react';
import type { Point } from '../primitives/geometry.ts';
import type { Size } from '../primitives/types.ts';
import type { SemanticColour, Theme } from '../theme/index.ts';
import {
  MARK_ANGLE_DEG,
  MARK_FRAME_BAND,
  MARK_OVERHANG,
  MARK_RADIUS,
  focusUnderlineView,
  UNDERLINE_HEIGHT,
  UNDERLINE_OVERHANG,
  UNDERLINE_RADIUS,
  markFill,
  markShape,
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
  /**
   * The element's size. Cards and spatial containers pass it, so above `MARK_FRAME_MIN` they get
   * a frame mark (`markShape`); text-like elements leave it out and always get a swipe.
   */
  size?: Size;
};

/**
 * A highlighter swipe behind a box element, overhanging it by `MARK_OVERHANG` (or, for a large
 * element, a frame band centred on its border, drawn over its content, that leaves the inside
 * untouched), plus the pulse ripple.
 * Place it as the first child of an element styled with `markHostCss`.
 */
export function BoxMark({ theme, levels, radius = MARK_RADIUS, size }: BoxMarkProps) {
  const view = markView(theme, levels);
  if (!view) return null;
  const corner = (extra: number) => (radius === 'round' ? '50%' : radius + extra);
  const frame = markShape(size) === 'frame';
  return (
    <>
      {view.swipe > 0 ? (
        <div
          style={{
            position: 'absolute',
            inset: frame ? -MARK_FRAME_BAND / 2 : -MARK_OVERHANG,
            // A frame leaves the inside untouched, so it can sit over opaque content (a map).
            zIndex: frame ? 1 : -1,
            borderRadius: corner(frame ? MARK_FRAME_BAND / 2 : 0),
            ...(frame
              ? { border: `${MARK_FRAME_BAND}px solid ${markFill(theme)}` }
              : { background: markFill(theme) }),
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

type FocusUnderlineProps = {
  theme: Theme;
  /** The semantic the text is drawn in; only `focus` gets an underline. */
  semantic: SemanticColour;
  /** The element's held highlight: while it shows, the swipe replaces the underline. */
  highlight?: number;
  /**
   * Text that may wrap (a headline): the band is drawn per line as a background, without the
   * tilt. Otherwise one tilted band sits behind the lower part of a single-line text box.
   */
  wrap?: boolean;
  children: ReactNode;
};

/**
 * A resting highlighter band behind the lower part of focus text (`focusUnderlineView`). Wrap
 * the text itself in it. Returns the children untouched when no underline shows, so glow themes
 * and other semantics render exactly as before.
 */
export function FocusUnderline({
  theme,
  semantic,
  highlight,
  wrap,
  children,
}: FocusUnderlineProps) {
  const view = focusUnderlineView(theme, semantic, highlight);
  if (!view) return <>{children}</>;
  if (wrap) {
    const top = `${Math.round((1 - UNDERLINE_HEIGHT) * 100)}%`;
    return (
      <span
        style={{
          backgroundImage: `linear-gradient(transparent ${top}, ${view.fill} ${top})`,
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
          borderRadius: UNDERLINE_RADIUS,
          padding: `0 ${UNDERLINE_OVERHANG}px`,
          margin: `0 ${-UNDERLINE_OVERHANG}px`,
        }}
      >
        {children}
      </span>
    );
  }
  return (
    <span style={{ position: 'relative', isolation: 'isolate', display: 'inline-block' }}>
      <span
        style={{
          position: 'absolute',
          left: -UNDERLINE_OVERHANG,
          right: -UNDERLINE_OVERHANG,
          bottom: 0,
          height: `${UNDERLINE_HEIGHT * 100}%`,
          zIndex: -1,
          borderRadius: UNDERLINE_RADIUS,
          background: view.fill,
          transform: `rotate(${MARK_ANGLE_DEG}deg)`,
        }}
      />
      {children}
    </span>
  );
}
