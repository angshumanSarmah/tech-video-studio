import { emphasisFilter, emphasisLineWidth, markLevels } from '../../emphasis/emphasis.ts';
import { LineMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss } from '../../theme/index.ts';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { clamp01, partialPolyline, pathD } from '../geometry.ts';
import { revealState } from '../reveal.ts';
import { bracePoints } from './brace.ts';
import { BRACE_DEPTH, type BracketProps } from './definition.ts';

/** The label fades in over the last part of the draw. */
const LABEL_FROM = 0.6;

/**
 * A brace with a label at its tip, across its box: on a board the layout makes the box span its
 * targets, under them.
 */
export function Bracket({ theme, props, box, state }: PrimitiveComponentProps<BracketProps>) {
  const { draw, opacity } = revealState(state);
  const tint = semanticTint(theme, props.semantic);
  const inset = theme.stroke.bold;
  const points = bracePoints(box.width - 2 * inset, BRACE_DEPTH).map((p) => ({
    x: p.x + inset,
    y: p.y + inset,
  }));
  const d = pathD(partialPolyline(points, draw));
  const width = emphasisLineWidth(theme, state, {
    rest: theme.stroke.regular,
    glow: theme.stroke.regular + theme.stroke.thin * state.emphasis,
  });
  const colour = props.semantic === 'neutral' ? theme.colours.ink.primary : tint.base;
  return (
    <div style={{ position: 'relative', width: box.width, height: box.height, opacity }}>
      <svg
        width={box.width}
        height={box.height}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        {draw > 0 ? (
          <LineMark theme={theme} levels={markLevels(state)} d={d} width={width} />
        ) : null}
        {draw > 0 ? (
          <path
            d={d}
            fill="none"
            stroke={colour}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: emphasisFilter(theme, tint, state.emphasis) }}
          />
        ) : null}
      </svg>
      <div
        style={{
          ...textCss(theme, 'tag'),
          position: 'absolute',
          left: 0,
          right: 0,
          top: inset + BRACE_DEPTH + theme.space.sm,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          color: colour,
          opacity: clamp01((draw - LABEL_FROM) / (1 - LABEL_FROM)),
        }}
      >
        {props.label}
      </div>
    </div>
  );
}
