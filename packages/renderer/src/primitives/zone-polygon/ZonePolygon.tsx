import { semanticTint, textCss, withAlpha, type Theme } from '../../theme/index.ts';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { partState, type PartState } from '../element-state.ts';
import { svgPoints } from '../geometry.ts';
import {
  emphasisFilter,
  emphasisStroke,
  EMPHASIS_THRESHOLD,
  markHostCss,
  markLevels,
} from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import type { ZonePolygonProps } from './definition.ts';
import { zoneShapes, type ZoneShape } from './zones.ts';

type Zone = ZonePolygonProps['zones'][number];

/** Fill opacity at rest and when emphasised or rejected; overlaps show as denser fill. */
const FILL_ALPHA = 0.16;
const FILL_ALPHA_STRONG = 0.34;

/** Overlapping, labelled areas; each zone is a part with its own state. */
export function ZonePolygon({
  theme,
  props,
  box,
  state,
}: PrimitiveComponentProps<ZonePolygonProps>) {
  const shapes = zoneShapes(props.zones.length, box, props.overlap);
  const parts = props.zones.map((z) => partState(state, z.id));
  return (
    <div
      style={{
        ...markHostCss(theme),
        position: 'relative',
        width: box.width,
        height: box.height,
        opacity: state.presence * (1 - 0.7 * state.dimmed),
        filter: emphasisFilter(theme, semanticTint(theme, 'neutral'), state.emphasis),
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} />
      <svg
        width={box.width}
        height={box.height}
        style={{ position: 'absolute', overflow: 'visible' }}
      >
        {props.zones.map((zone, i) => {
          const shape = shapes[i];
          const part = parts[i];
          return shape && part ? (
            <ZoneShapeView key={zone.id} theme={theme} zone={zone} shape={shape} part={part} />
          ) : null;
        })}
      </svg>
      {props.zones.map((zone, i) => {
        const shape = shapes[i];
        const part = parts[i];
        return shape && part ? (
          <ZoneLabel key={zone.id} theme={theme} zone={zone} shape={shape} part={part} />
        ) : null;
      })}
    </div>
  );
}

function zoneTint(theme: Theme, zone: Zone, part: PartState) {
  return semanticTint(theme, (part.actions.reject ?? 0) > 0 ? 'problem' : zone.semantic);
}

type ZoneViewProps = { theme: Theme; zone: Zone; shape: ZoneShape; part: PartState };

function ZoneShapeView({ theme, zone, shape, part }: ZoneViewProps) {
  const tint = zoneTint(theme, zone, part);
  const strength = Math.max(part.emphasis, part.actions.reject ?? 0);
  const alpha = FILL_ALPHA + (FILL_ALPHA_STRONG - FILL_ALPHA) * strength;
  const scale = 0.92 + 0.08 * part.presence + 0.03 * part.emphasis;
  const { x, y } = shape.centre;
  return (
    <polygon
      points={svgPoints(shape.points)}
      fill={withAlpha(tint.base, alpha)}
      stroke={tint.border}
      strokeWidth={emphasisStroke(theme, theme.stroke.regular, part)}
      strokeLinejoin="round"
      opacity={part.presence * (1 - 0.7 * part.dimmed)}
      transform={`translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`}
      style={{ filter: emphasisFilter(theme, tint, part.emphasis) }}
    />
  );
}

function ZoneLabel({ theme, zone, shape, part }: ZoneViewProps) {
  const tint = zoneTint(theme, zone, part);
  const strong = part.emphasis > EMPHASIS_THRESHOLD || (part.actions.reject ?? 0) > 0;
  return (
    <div
      style={{
        ...textCss(theme, 'label'),
        position: 'absolute',
        left: shape.centre.x,
        top: shape.centre.y,
        transform: 'translate(-50%, -50%)',
        whiteSpace: 'nowrap',
        color: strong ? tint.base : theme.colours.ink.primary,
        opacity: part.presence * (1 - 0.7 * part.dimmed),
      }}
    >
      {zone.label}
    </div>
  );
}
