import {
  emphasisFilter,
  emphasisLineWidth,
  EMPHASIS_THRESHOLD,
  markLevels,
} from '../../emphasis/emphasis.ts';
import { LineMark, PointMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss, type Theme, type Tint } from '../../theme/index.ts';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { partState, type PartState } from '../element-state.ts';
import { clamp01, partialPolyline, pathD, type Point } from '../geometry.ts';
import { CrossMark, PinMark } from '../svg-marks.tsx';
import { routeInset, type RoutePathProps } from './definition.ts';
import { routeDraw, routeLayout } from './route.ts';

/** The distance tag fades in over the last stretch of the draw. */
const TAG_FROM = 0.85;

/** End pin height in px; a label above the end stop clears it. */
const PIN = 56;

/** A glowing route between named stops, drawn progressively on `move`. */
export function RoutePath({ theme, props, box, state }: PrimitiveComponentProps<RoutePathProps>) {
  const layout = routeLayout(props.stops.length, box, routeInset(theme));
  const tint = semanticTint(theme, props.semantic);
  const draw = routeDraw(state.elapsed.move);
  const width = emphasisLineWidth(theme, state, {
    rest: theme.stroke.bold * 1.4,
    glow: theme.stroke.bold * (1.4 + 0.5 * state.emphasis),
  });
  const routeD = pathD(partialPolyline(layout.path, draw));
  const end = layout.stops.at(-1);
  return (
    <div
      style={{
        position: 'relative',
        width: box.width,
        height: box.height,
        opacity: state.presence * (1 - 0.7 * state.dimmed),
      }}
    >
      <svg
        width={box.width}
        height={box.height}
        style={{ position: 'absolute', overflow: 'visible' }}
      >
        {draw > 0 ? (
          <LineMark theme={theme} levels={markLevels(state)} d={routeD} width={width} />
        ) : null}
        {draw > 0 ? (
          <path
            d={routeD}
            fill="none"
            stroke={tint.base}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: tint.glowFilter }}
          />
        ) : null}
        {layout.stops.map((at, i) => (
          <Stop
            key={props.stops[i]?.id ?? i}
            theme={theme}
            tint={tint}
            at={at}
            kind={i === 0 ? 'start' : i === layout.stops.length - 1 ? 'end' : 'via'}
            reached={i === 0 || i === layout.stops.length - 1 || draw >= (layout.stopAt[i] ?? 1)}
            part={partState(state, props.stops[i]?.id ?? '')}
          />
        ))}
      </svg>
      {props.stops.map((stop, i) =>
        stop.label && layout.stops[i] ? (
          <StopLabel
            key={stop.id}
            theme={theme}
            text={stop.label}
            at={layout.stops[i]}
            above={layout.labelAbove[i] ? (i === props.stops.length - 1 ? PIN : 0) : undefined}
            colour={stopColour(theme, tint, partState(state, stop.id))}
          />
        ) : null,
      )}
      {props.distance && end ? (
        <DistanceTag
          theme={theme}
          tint={tint}
          text={props.distance}
          at={end}
          opacity={clamp01((draw - TAG_FROM) / (1 - TAG_FROM))}
        />
      ) : null}
    </div>
  );
}

type StopProps = {
  theme: Theme;
  tint: Tint;
  at: Point;
  kind: 'start' | 'end' | 'via';
  reached: boolean;
  part: PartState;
};

function Stop({ theme, tint, at, kind, reached, part }: StopProps) {
  const rejected = part.actions.reject ?? 0;
  const colour = rejected > 0 ? semanticTint(theme, 'problem') : tint;
  const glow = emphasisFilter(theme, colour, part.emphasis);
  const grow = 1 + 0.35 * part.emphasis;
  const cross = { x: at.x + 26, y: at.y - 26 };
  const r = (kind === 'start' ? 14 : kind === 'end' ? PIN / 3 : 10) * grow;
  const mark = <PointMark theme={theme} levels={markLevels(part)} at={at} r={r} />;
  if (kind === 'end') {
    return (
      <g>
        {mark}
        <PinMark
          at={at}
          size={PIN * grow}
          colour={colour.base}
          fill={theme.colours.background}
          filter={glow}
        />
        <CrossMark theme={theme} at={cross} colour={colour.base} progress={rejected} />
      </g>
    );
  }
  return (
    <g style={{ filter: glow }}>
      {mark}
      <circle
        cx={at.x}
        cy={at.y}
        r={r}
        fill={reached ? colour.base : theme.colours.background}
        stroke={colour.base}
        strokeWidth={theme.stroke.regular}
      />
      {kind === 'start' ? (
        <circle cx={at.x} cy={at.y} r={r * 0.4} fill={theme.colours.background} />
      ) : null}
      <CrossMark theme={theme} at={cross} colour={colour.base} progress={rejected} />
    </g>
  );
}

function stopColour(theme: Theme, tint: Tint, part: PartState): string {
  if ((part.actions.reject ?? 0) > 0) return theme.colours.semantic.problem;
  return part.emphasis > EMPHASIS_THRESHOLD ? tint.base : theme.colours.ink.muted;
}

type StopLabelProps = {
  theme: Theme;
  text: string;
  at: Point;
  /** Px of marker to clear above the stop when the label goes above it; undefined: below. */
  above: number | undefined;
  colour: string;
};

function StopLabel({ theme, text, at, above, colour }: StopLabelProps) {
  const top = above === undefined ? at.y + theme.space.md : at.y - above - theme.space.md;
  return (
    <div
      style={{
        ...textCss(theme, 'label'),
        position: 'absolute',
        left: at.x,
        top,
        transform: above === undefined ? 'translateX(-50%)' : 'translate(-50%, -100%)',
        whiteSpace: 'nowrap',
        color: colour,
      }}
    >
      {text}
    </div>
  );
}

type DistanceTagProps = { theme: Theme; tint: Tint; text: string; at: Point; opacity: number };

/** A pill above-left of the end pin, so it never covers the route's last leg. */
function DistanceTag({ theme, tint, text, at, opacity }: DistanceTagProps) {
  if (opacity <= 0) return null;
  return (
    <div
      style={{
        ...textCss(theme, 'tag'),
        position: 'absolute',
        right: `calc(100% - ${at.x - theme.space.md}px)`,
        bottom: `calc(100% - ${at.y - theme.space.xl}px)`,
        padding: `${theme.space.xs}px ${theme.space.sm}px`,
        borderRadius: theme.radius.pill,
        background: tint.base,
        color: theme.colours.background,
        whiteSpace: 'nowrap',
        opacity,
        transform: `scale(${0.8 + 0.2 * opacity})`,
        transformOrigin: 'bottom right',
        boxShadow: tint.glowShadow,
      }}
    >
      {text}
    </div>
  );
}
