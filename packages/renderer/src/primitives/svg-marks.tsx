import type { Theme } from '../theme/index.ts';
import type { Point } from './geometry.ts';

/** SVG marks shared by primitives drawn as paths (connector, packet stream, route, zones). */

type CrossMarkProps = {
  theme: Theme;
  at: Point;
  colour: string;
  /** 0..1: fades and grows in with its action's progress. */
  progress: number;
  radius?: number;
};

/** A filled disc with a ✗ drawn as strokes (no font needed): a refusal on a line or shape. */
export function CrossMark({ theme, at, colour, progress, radius = 18 }: CrossMarkProps) {
  if (progress <= 0) return null;
  const r = radius * (0.6 + 0.4 * progress);
  const arm = r * 0.45;
  return (
    <g opacity={progress}>
      <circle cx={at.x} cy={at.y} r={r} fill={colour} />
      <path
        d={`M ${at.x - arm} ${at.y - arm} L ${at.x + arm} ${at.y + arm} M ${at.x + arm} ${at.y - arm} L ${at.x - arm} ${at.y + arm}`}
        stroke={theme.colours.background}
        strokeWidth={theme.stroke.regular}
        strokeLinecap="round"
      />
    </g>
  );
}

type PinProps = { at: Point; size: number; colour: string; fill: string; filter?: string };

/** A map pin whose tip sits on `at`: the end of a route. */
export function PinMark({ at, size, colour, fill, filter }: PinProps) {
  const r = size * 0.38;
  const cy = at.y - size + r;
  return (
    <g style={{ filter }}>
      <path
        d={`M ${at.x} ${at.y} C ${at.x - r * 0.3} ${cy + r * 1.2} ${at.x - r} ${cy + r * 0.6} ${at.x - r} ${cy} A ${r} ${r} 0 1 1 ${at.x + r} ${cy} C ${at.x + r} ${cy + r * 0.6} ${at.x + r * 0.3} ${cy + r * 1.2} ${at.x} ${at.y} Z`}
        fill={colour}
      />
      <circle cx={at.x} cy={cy} r={r * 0.42} fill={fill} />
    </g>
  );
}
