import { useMemo } from 'react';
import { semanticTint, withAlpha } from '../../theme/index.ts';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { pathD } from '../geometry.ts';
import { emphasisShadow, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { AVENUE, cityMap, RIVER_WIDTH, STREET } from './city.ts';
import type { MapBaseProps } from './definition.ts';

/** Map layers stay quiet so content drawn over them reads first. */
const PARK_ALPHA = 0.12;
const AVENUE_ALPHA = 0.5;

/** A stylised top-down city, clipped to a rounded panel. */
export function MapBase({ theme, props, box, state }: PrimitiveComponentProps<MapBaseProps>) {
  const city = useMemo(() => cityMap(props.variant, box), [props.variant, box]);
  const park = semanticTint(theme, 'ok');
  const water = semanticTint(theme, 'concept');
  const glow = emphasisShadow(theme, semanticTint(theme, 'concept'), state.emphasis);
  return (
    <div
      style={{
        ...markHostCss(theme),
        width: box.width,
        height: box.height,
        borderRadius: theme.radius.lg,
        overflow: 'hidden',
        background: theme.colours.surface,
        border: `${theme.stroke.thin}px solid ${theme.colours.line}`,
        boxSizing: 'border-box',
        boxShadow: glow,
        opacity: state.presence * (1 - 0.6 * state.dimmed),
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.lg} />
      <svg width={box.width} height={box.height}>
        {city.streets
          .filter((s) => s.avenue)
          .map((s, i) => (
            <line
              key={i}
              x1={s.from.x}
              y1={s.from.y}
              x2={s.to.x}
              y2={s.to.y}
              stroke={withAlpha(theme.colours.line, AVENUE_ALPHA)}
              strokeWidth={AVENUE}
            />
          ))}
        {city.blocks.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            rx={theme.radius.sm}
            fill={b.park ? withAlpha(park.base, PARK_ALPHA) : theme.colours.surfaceRaised}
            stroke={b.park ? park.border : 'none'}
            strokeOpacity={0.35}
            strokeWidth={theme.stroke.hairline}
          />
        ))}
        {city.river.length > 1 ? (
          <path
            d={pathD(city.river)}
            fill="none"
            stroke={water.soft}
            strokeWidth={RIVER_WIDTH}
            strokeLinecap="butt"
          />
        ) : null}
        {city.streets
          .filter((s) => s.avenue)
          .map((s, i) => (
            <line
              key={i}
              x1={s.from.x}
              y1={s.from.y}
              x2={s.to.x}
              y2={s.to.y}
              stroke={theme.colours.ink.faint}
              strokeOpacity={0.35}
              strokeWidth={theme.stroke.hairline}
              strokeDasharray={`${STREET} ${STREET}`}
            />
          ))}
      </svg>
    </div>
  );
}
