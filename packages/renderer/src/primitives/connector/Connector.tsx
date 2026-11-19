import { emphasisFilter, emphasisLineWidth, markLevels } from '../../emphasis/emphasis.ts';
import { LineMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss, type Theme, type Tint } from '../../theme/index.ts';
import type { PrimitiveComponentProps } from '../component-props.ts';
import {
  arrowHead,
  partialPolyline,
  pathD,
  pointAlong,
  standalonePath,
  svgPoints,
  type Point,
} from '../geometry.ts';
import { revealState } from '../reveal.ts';
import { CrossMark } from '../svg-marks.tsx';
import { packetProgress } from './packet.ts';
import { connectorInset, type ConnectorProps } from './definition.ts';

/**
 * A line or arrow between two elements, along the path the layout gives it (straight across its
 * own box when it stands alone), with a small port dot at each end.
 */
export function Connector({
  theme,
  props,
  box,
  state,
  path,
}: PrimitiveComponentProps<ConnectorProps>) {
  const points = path ? [...path] : standalonePath(box, connectorInset(theme));
  const { draw, opacity } = revealState(state);
  const rejected = state.actions.reject ?? 0;
  const tint = semanticTint(theme, rejected > 0 ? 'problem' : props.semantic);
  const glow = emphasisFilter(theme, tint, state.emphasis);
  const width = emphasisLineWidth(theme, state, {
    rest: theme.stroke.regular,
    glow: theme.stroke.regular + theme.stroke.thin * state.emphasis,
  });
  const drawn = partialPolyline(points, draw);
  const tip = pointAlong(points, draw);
  const middle = pointAlong(points, 0.5).point;
  const packet = packetProgress(state.elapsed.move);
  return (
    <div style={{ position: 'relative', width: box.width, height: box.height, opacity }}>
      <svg
        width={box.width}
        height={box.height}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        {draw > 0 ? (
          <LineMark theme={theme} levels={markLevels(state)} d={pathD(drawn)} width={width} />
        ) : null}
        <Ports theme={theme} points={points} draw={draw} />
        <g style={{ filter: glow }} fill={tint.base}>
          {draw > 0 ? (
            <path
              d={pathD(drawn)}
              fill="none"
              stroke={tint.base}
              strokeWidth={width}
              strokeLinecap="round"
              strokeDasharray={props.dashed ? `${width * 3} ${width * 2.5}` : undefined}
            />
          ) : null}
          {draw > 0 && props.heads !== 'none' ? (
            <polygon points={svgPoints(arrowHead(tip.point, tip.angle, width * 4))} />
          ) : null}
          {draw > 0 && props.heads === 'both' ? (
            <polygon points={svgPoints(arrowHead(points[0] ?? tip.point, Math.PI, width * 4))} />
          ) : null}
        </g>
        {packet !== undefined ? (
          <Packet theme={theme} tint={tint} at={pointAlong(points, packet).point} />
        ) : null}
        <CrossMark theme={theme} at={middle} colour={tint.base} progress={rejected} />
      </svg>
      {props.label ? (
        <Label theme={theme} text={props.label} at={middle} opacity={labelOpacity(draw)} />
      ) : null}
    </div>
  );
}

/** The label appears once the line is half drawn. */
function labelOpacity(draw: number): number {
  return Math.min(1, Math.max(0, (draw - 0.5) * 2));
}

function Ports({ theme, points, draw }: { theme: Theme; points: Point[]; draw: number }) {
  const r = theme.stroke.regular * 1.5;
  const first = points[0];
  const last = points.at(-1);
  return (
    <g fill={theme.colours.ink.faint}>
      {first && draw > 0 ? <circle cx={first.x} cy={first.y} r={r} /> : null}
      {last && draw >= 1 ? <circle cx={last.x} cy={last.y} r={r} /> : null}
    </g>
  );
}

function Packet({ theme, tint, at }: { theme: Theme; tint: Tint; at: Point }) {
  return (
    <circle
      cx={at.x}
      cy={at.y}
      r={theme.stroke.bold * 1.6}
      fill={tint.base}
      style={{ filter: tint.glowFilter }}
    />
  );
}

type LabelProps = { theme: Theme; text: string; at: Point; opacity: number };

function Label({ theme, text, at, opacity }: LabelProps) {
  return (
    <div
      style={{
        ...textCss(theme, 'label'),
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: `calc(100% - ${at.y - theme.space.sm}px)`,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        color: theme.colours.ink.muted,
        opacity,
      }}
    >
      {text}
    </div>
  );
}
