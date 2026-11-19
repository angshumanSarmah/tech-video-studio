import { emphasisFilter, markLevels } from '../../emphasis/emphasis.ts';
import { LineMark } from '../../emphasis/Mark.tsx';
import { semanticTint, withAlpha } from '../../theme/index.ts';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { connectorInset } from '../connector/definition.ts';
import { pathD, pointAlong, standalonePath } from '../geometry.ts';
import { CrossMark } from '../svg-marks.tsx';
import type { PacketStreamProps } from './definition.ts';
import { BLOCK_AT, streamPackets } from './stream.ts';

/** Track opacity: a hint of the path, so the stream reads on its own and over its connector. */
const TRACK_ALPHA = 0.25;

/**
 * Packets flowing along a connector. Until the layout engine (P1A.9) hands it the connector's
 * path, it flows straight across its own box over a faint track.
 */
export function PacketStream({
  theme,
  props,
  box,
  state,
}: PrimitiveComponentProps<PacketStreamProps>) {
  const points = standalonePath(box, connectorInset(theme));
  const rejected = state.actions.reject ?? 0;
  const tint = semanticTint(theme, rejected > 0 ? 'problem' : props.semantic);
  const packets = streamPackets({
    rate: props.rate,
    flowSec: state.elapsed.enter,
    stopSec: state.elapsed.exit,
    blocked: rejected > 0,
  });
  const size = theme.stroke.bold * (1 + 0.3 * state.emphasis);
  const barrier = pointAlong(points, BLOCK_AT).point;
  return (
    <svg
      width={box.width}
      height={box.height}
      style={{ overflow: 'visible', opacity: 1 - 0.7 * state.dimmed }}
    >
      <LineMark theme={theme} levels={markLevels(state)} d={pathD(points)} width={size * 2} />
      <path
        d={pathD(points)}
        stroke={withAlpha(tint.base, TRACK_ALPHA)}
        strokeWidth={theme.stroke.thin}
        fill="none"
      />
      <g fill={tint.base} style={{ filter: emphasisFilter(theme, tint, state.emphasis) }}>
        {packets.map(({ t, opacity }, i) => {
          const { point, angle } = pointAlong(points, t);
          return (
            <rect
              key={i}
              x={-size * 1.4}
              y={-size}
              width={size * 2.8}
              height={size * 2}
              rx={size * 0.5}
              opacity={opacity}
              transform={`translate(${point.x} ${point.y}) rotate(${(angle * 180) / Math.PI})`}
            />
          );
        })}
      </g>
      {rejected > 0 ? (
        <g opacity={rejected}>
          <line
            x1={barrier.x}
            x2={barrier.x}
            y1={barrier.y - size * 6}
            y2={barrier.y + size * 6}
            stroke={tint.base}
            strokeWidth={theme.stroke.bold}
            strokeLinecap="round"
          />
          <CrossMark
            theme={theme}
            at={{ x: barrier.x, y: barrier.y - size * 6 }}
            colour={tint.base}
            progress={rejected}
          />
        </g>
      ) : null}
    </svg>
  );
}
