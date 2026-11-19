import { emphasisFilter, emphasisLineWidth, markLevels } from '../../emphasis/emphasis.ts';
import { LineMark } from '../../emphasis/Mark.tsx';
import { semanticFill, semanticTint, textCss } from '../../theme/index.ts';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { growView } from '../overlay.ts';
import type { RadiusRingProps } from './definition.ts';

/** Translucent wash inside the ring, at the ring's own strength. */
const AREA_ALPHA = 0.08;

/**
 * A dashed circle around an element, with a dot at the centre: on a board the layout centres its
 * box on `around` and makes it large enough to enclose it.
 */
export function RadiusRing({ theme, props, box, state }: PrimitiveComponentProps<RadiusRingProps>) {
  const tint = semanticTint(theme, props.semantic);
  const motion = growView(state);
  const width = emphasisLineWidth(theme, state, {
    rest: theme.stroke.regular,
    glow: theme.stroke.regular + theme.stroke.thin * state.emphasis,
  });
  const size = Math.min(box.width, box.height);
  const r = size / 2 - theme.stroke.bold;
  const c = { x: box.width / 2, y: box.height - size / 2 };
  const circleD = `M ${c.x - r} ${c.y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  return (
    <div
      style={{
        position: 'relative',
        width: box.width,
        height: box.height,
        opacity: motion.opacity,
        transform: motion.transform,
        transformOrigin: `${c.x}px ${c.y}px`,
      }}
    >
      <svg
        width={box.width}
        height={box.height}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        <LineMark theme={theme} levels={markLevels(state)} d={circleD} width={width} />
        <path
          d={circleD}
          fill={semanticFill(theme, props.semantic, AREA_ALPHA)}
          stroke={tint.base}
          strokeWidth={width}
          strokeDasharray={`${width * 4} ${width * 3}`}
          style={{ filter: emphasisFilter(theme, tint, state.emphasis) }}
        />
        <circle cx={c.x} cy={c.y} r={theme.stroke.bold} fill={tint.base} />
      </svg>
      {props.label ? (
        <div
          style={{
            ...textCss(theme, 'tag'),
            position: 'absolute',
            left: c.x,
            top: c.y - r,
            transform: 'translate(-50%, -50%)',
            padding: `${theme.space.xs}px ${theme.space.sm}px`,
            borderRadius: theme.radius.pill,
            background: theme.colours.background,
            color: tint.base,
            whiteSpace: 'nowrap',
          }}
        >
          {props.label}
        </div>
      ) : null}
    </div>
  );
}
