import { AssetGlyph } from '../../assets/AssetGlyph.tsx';
import { semanticTint, textCss, type Theme } from '../../theme/index.ts';
import { Badge, SMALL_BADGE, SMALL_BADGE_GLYPH } from '../badge.tsx';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { IDLE_STATE, partState, type PartState } from '../element-state.ts';
import { shakeOffset } from '../motion.ts';
import { cardSurfaceCss } from '../surface.ts';
import { emphasisFilter, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { conveyorMetrics, type ConveyorMetrics, type ConveyorQueueProps } from './definition.ts';
import { queuePlaces, treadShift, type QueueGeometry } from './queue.ts';

type Item = ConveyorQueueProps['items'][number];

/** A belt of blocks moving toward its right end, where they are taken. */
export function ConveyorQueue({
  theme,
  props,
  box,
  state,
}: PrimitiveComponentProps<ConveyorQueueProps>) {
  const m = conveyorMetrics(props, theme);
  const parts = props.items.map((item) => partState(state, item.id));
  const inputs = parts.map((p) => ({ presence: p.presence, taken: p.actions.exit ?? 0 }));
  const geometry = queueGeometry(box.width, m);
  const places = queuePlaces(inputs, geometry);
  return (
    <div
      style={{
        ...markHostCss(theme),
        position: 'relative',
        width: box.width,
        height: box.height,
        opacity: state.presence * (1 - 0.7 * state.dimmed),
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.md} />
      <Belt
        theme={theme}
        width={box.width}
        m={m}
        shift={treadShift(inputs, m.pitch)}
        emphasis={state.emphasis}
      />
      {props.items.map((item, i) => (
        <Block
          key={item.id}
          theme={theme}
          item={item}
          part={parts[i] ?? IDLE_STATE}
          m={m}
          x={places[i]?.x ?? 0}
          lift={places[i]?.lift ?? 0}
          opacity={places[i]?.opacity ?? 0}
        />
      ))}
      {props.label ? (
        <div
          style={{
            ...textCss(theme, 'label'),
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            textAlign: 'center',
            color: theme.colours.ink.muted,
            whiteSpace: 'nowrap',
          }}
        >
          {props.label}
        </div>
      ) : null}
    </div>
  );
}

function queueGeometry(width: number, m: ConveyorMetrics): QueueGeometry {
  const beltStart = m.pad + m.belt / 2;
  return {
    headX: width - beltStart - m.pitch / 2,
    pitch: m.pitch,
    entryX: beltStart - m.pitch,
    liftPx: m.headroom,
  };
}

type BeltProps = {
  theme: Theme;
  width: number;
  m: ConveyorMetrics;
  shift: number;
  emphasis: number;
};

/** The belt band with a roller at each end and treads that move as blocks are taken. */
function Belt({ theme, width, m, shift, emphasis }: BeltProps) {
  const top = m.headroom + m.block.height;
  const start = m.pad + m.belt / 2;
  const length = width - 2 * start;
  const spacing = m.pitch / 2;
  const treads = Math.floor(length / spacing);
  const tint = semanticTint(theme, 'neutral');
  return (
    <svg
      width={width}
      height={m.belt}
      style={{
        position: 'absolute',
        left: 0,
        top,
        overflow: 'visible',
        filter: emphasisFilter(theme, tint, emphasis),
      }}
    >
      <rect
        x={m.pad}
        y={0}
        width={width - 2 * m.pad}
        height={m.belt}
        rx={m.belt / 2}
        fill={theme.colours.surfaceRaised}
        stroke={theme.colours.line}
        strokeWidth={theme.stroke.regular}
      />
      <g stroke={theme.colours.ink.faint} strokeWidth={theme.stroke.thin}>
        {Array.from({ length: treads }, (_, k) => {
          const x = start + ((k * spacing + shift) % length);
          return <line key={k} x1={x} x2={x} y1={m.belt * 0.3} y2={m.belt * 0.7} />;
        })}
      </g>
      {[start, width - start].map((cx) => (
        <circle key={cx} cx={cx} cy={m.belt / 2} r={m.belt * 0.28} fill={theme.colours.ink.faint} />
      ))}
    </svg>
  );
}

type BlockProps = {
  theme: Theme;
  item: Item;
  part: PartState;
  m: ConveyorMetrics;
  x: number;
  lift: number;
  opacity: number;
};

function Block({ theme, item, part, m, x, lift, opacity }: BlockProps) {
  if (opacity <= 0) return null;
  const rejected = part.actions.reject ?? 0;
  const locked = part.actions.lock ?? 0;
  const tint = semanticTint(theme, rejected > 0 ? 'problem' : item.semantic);
  const shake = shakeOffset(rejected, theme.space.xs);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...cardSurfaceCss(theme, tint, part),
        ...textCss(theme, 'hud'),
        position: 'absolute',
        left: x - m.block.width / 2 + shake,
        top: m.headroom - lift - theme.stroke.regular,
        width: m.block.width,
        height: m.block.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: theme.colours.ink.primary,
        whiteSpace: 'nowrap',
        opacity: opacity * (1 - 0.7 * part.dimmed),
        transform: `scale(${1 + 0.08 * part.emphasis})`,
      }}
    >
      <BoxMark theme={theme} levels={markLevels(part)} radius={theme.radius.sm} />
      {item.label}
      {locked > 0 ? (
        <Badge
          theme={theme}
          colour={semanticTint(theme, 'focus').base}
          opacity={locked}
          size={SMALL_BADGE}
        >
          <AssetGlyph
            theme={theme}
            assetId="lock"
            size={SMALL_BADGE_GLYPH}
            colour={theme.colours.background}
          />
        </Badge>
      ) : null}
      {rejected > 0 ? (
        <Badge theme={theme} colour={tint.base} opacity={rejected} size={SMALL_BADGE} left>
          ✗
        </Badge>
      ) : null}
    </div>
  );
}
