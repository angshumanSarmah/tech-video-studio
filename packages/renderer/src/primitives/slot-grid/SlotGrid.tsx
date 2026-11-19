import type { CSSProperties } from 'react';
import { AssetGlyph } from '../../assets/AssetGlyph.tsx';
import { emphasisFilter, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss, type Theme } from '../../theme/index.ts';
import { Badge, SMALL_BADGE, SMALL_BADGE_GLYPH } from '../badge.tsx';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { partState, type PartState } from '../element-state.ts';
import { shakeOffset } from '../motion.ts';
import { cardSurfaceCss } from '../surface.ts';
import {
  SLOT_ICON,
  slotMetrics,
  type SlotGridProps,
  type SlotKind,
  type SlotMetrics,
} from './definition.ts';
import { slotGridShape, slotRows } from './slots.ts';

type Slot = SlotGridProps['slots'][number];

/** A grid of slots; each slot is a part with its own state. */
export function SlotGrid({ theme, props, box, state }: PrimitiveComponentProps<SlotGridProps>) {
  const m = slotMetrics(props, theme);
  const { cols } = slotGridShape(props.slots.length, props.cols);
  return (
    <div
      style={{
        ...markHostCss(theme),
        width: box.width,
        height: box.height,
        boxSizing: 'border-box',
        padding: m.gap,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: m.gap,
        opacity: state.presence * (1 - 0.7 * state.dimmed),
        filter: emphasisFilter(theme, semanticTint(theme, 'neutral'), state.emphasis),
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.md} />
      {slotRows(props.slots, cols).map((row, r) => (
        <div key={r} style={{ display: 'flex', gap: m.gap, ...shelfPlank(theme, props.kind) }}>
          {row.map((slot) => (
            <SlotView
              key={slot.id}
              theme={theme}
              kind={props.kind}
              slot={slot}
              m={m}
              part={partState(state, slot.id)}
            />
          ))}
        </div>
      ))}
      {props.label ? (
        <div
          style={{
            ...textCss(theme, 'label'),
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

/** Shelves stand their rows on a plank. */
function shelfPlank(theme: Theme, kind: SlotKind): CSSProperties {
  if (kind !== 'shelf') return {};
  return {
    borderBottom: `${theme.stroke.bold}px solid ${theme.colours.line}`,
    paddingBottom: theme.stroke.bold,
    marginBottom: -theme.stroke.bold * 2,
  };
}

type SlotViewProps = { theme: Theme; kind: SlotKind; slot: Slot; m: SlotMetrics; part: PartState };

/** An empty outline with the item card over it; the card lifts away on `exit`. */
function SlotView({ theme, kind, slot, m, part }: SlotViewProps) {
  const rejected = part.actions.reject ?? 0;
  const locked = part.actions.lock ?? 0;
  const semantic = rejected > 0 ? 'problem' : locked > 0 ? 'focus' : slot.semantic;
  const tint = semanticTint(theme, semantic);
  const lift = theme.space.lg * (1 - part.presence);
  return (
    <div
      style={{ position: 'relative', width: m.card.width, height: m.card.height, flexShrink: 0 }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: shapeRadius(theme, kind),
          border: `${theme.stroke.thin}px dashed ${theme.colours.line}`,
        }}
      />
      <div
        style={{
          ...markHostCss(theme),
          ...cardSurfaceCss(theme, tint, part),
          ...textCss(theme, 'hud'),
          position: 'absolute',
          inset: 0,
          borderRadius: shapeRadius(theme, kind),
          clipPath: kind === 'documents' ? DOG_EAR : undefined,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.space.xs,
          color: theme.colours.ink.primary,
          whiteSpace: 'nowrap',
          opacity: part.presence * (1 - 0.7 * part.dimmed),
          transform: `translate(${shakeOffset(rejected, theme.space.xs)}px, ${-lift}px) scale(${1 + 0.08 * part.emphasis})`,
        }}
      >
        <BoxMark theme={theme} levels={markLevels(part)} radius={theme.radius.sm} />
        {slot.icon ? (
          <AssetGlyph theme={theme} assetId={slot.icon} size={SLOT_ICON} colour={tint.base} />
        ) : null}
        {slot.label}
      </div>
      {locked > 0 && part.presence > 0 ? (
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

/** Cuts the top-right corner off a document card. */
const DOG_EAR = 'polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%)';

/** Seats are rounded on top like a seat back; the rest are cards. */
function shapeRadius(theme: Theme, kind: SlotKind): string {
  const { sm, lg } = theme.radius;
  return kind === 'seats' ? `${lg}px ${lg}px ${sm}px ${sm}px` : `${sm}px`;
}
