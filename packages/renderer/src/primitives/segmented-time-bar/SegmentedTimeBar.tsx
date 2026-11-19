import { dimOpacity } from '../../events/presets.ts';
import { semanticFill, semanticTint, textCss, type Theme } from '../../theme/index.ts';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { partState, type PartState } from '../element-state.ts';
import {
  emphasisShadow,
  emphasisStroke,
  EMPHASIS_THRESHOLD,
  markHostCss,
  markLevels,
} from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { formatClock } from '../timer-ring/timer.ts';
import { timeBarMetrics, type SegmentedTimeBarProps, type TimeBarMetrics } from './definition.ts';
import { segmentFills, segmentStarts, segmentWidths, timeToX } from './segments.ts';

type Segment = SegmentedTimeBarProps['segments'][number];

/** Wash opacity of a segment at rest and when emphasised or rejected. */
const WASH = 0.22;
const WASH_STRONG = 0.45;

/** A stacked time budget: segments sized by time, total at the top right, optional budget. */
export function SegmentedTimeBar({
  theme,
  props,
  box,
  state,
}: PrimitiveComponentProps<SegmentedTimeBarProps>) {
  const m = timeBarMetrics(props, theme);
  const secs = props.segments.map((s) => s.sec);
  const total = secs.reduce((a, b) => a + b, 0);
  const budget = props.budgetSec;
  const spare = budget !== undefined && budget > total ? budget - total : 0;
  const values = spare > 0 ? [...secs, spare] : secs;
  const widths = segmentWidths(values, spare > 0 ? [...m.mins, 0] : m.mins, box.width);
  const lefts = segmentStarts(widths);
  const fills = segmentFills(props.segments.length, state.elapsed.enter);
  const over = budget !== undefined && total > budget;
  return (
    <div
      style={{
        ...markHostCss(theme),
        width: box.width,
        height: box.height,
        opacity: state.presence * dimOpacity(state.dimmed),
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} />
      <Header
        theme={theme}
        m={m}
        caption={props.label}
        total={total}
        budget={budget}
        over={over}
        emphasis={state.emphasis}
      />
      <div style={{ position: 'relative', height: m.bar }}>
        {props.segments.map((segment, i) => (
          <SegmentView
            key={segment.id}
            theme={theme}
            segment={segment}
            part={partState(state, segment.id)}
            left={lefts[i] ?? 0}
            width={widths[i] ?? 0}
            fill={fills[i] ?? 1}
          />
        ))}
        {spare > 0 ? (
          <SpareStretch
            theme={theme}
            left={timeToX(total, values, widths)}
            width={widths.at(-1) ?? 0}
          />
        ) : null}
        {over && budget !== undefined ? (
          <Overflow
            theme={theme}
            left={timeToX(budget, values, widths)}
            right={timeToX(total, values, widths)}
          />
        ) : null}
        {budget !== undefined ? (
          <BudgetMarker theme={theme} x={timeToX(budget, values, widths)} />
        ) : null}
      </div>
      <div style={{ position: 'relative', height: m.footer }}>
        {props.segments.map((segment, i) => (
          <div
            key={segment.id}
            style={{
              ...textCss(theme, 'hud'),
              position: 'absolute',
              top: theme.space.sm,
              left: lefts[i] ?? 0,
              width: widths[i] ?? 0,
              textAlign: 'center',
              color: theme.colours.ink.muted,
              opacity: fills[i] ?? 1,
            }}
          >
            {formatClock(segment.sec)}
          </div>
        ))}
      </div>
    </div>
  );
}

type HeaderProps = {
  theme: Theme;
  m: TimeBarMetrics;
  caption: string | undefined;
  total: number;
  budget: number | undefined;
  over: boolean;
  emphasis: number;
};

function Header({ theme, m, caption, total, budget, over, emphasis }: HeaderProps) {
  const tint = semanticTint(theme, over ? 'problem' : 'neutral');
  return (
    <div
      style={{
        height: m.header,
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: theme.space.sm,
      }}
    >
      <div
        style={{ ...textCss(theme, 'label'), color: theme.colours.ink.muted, whiteSpace: 'nowrap' }}
      >
        {caption ?? ''}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: theme.space.xs,
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            ...textCss(theme, 'title'),
            fontVariantNumeric: 'tabular-nums',
            color: over ? tint.base : theme.colours.ink.primary,
            textShadow: emphasisShadow(theme, tint, emphasis),
          }}
        >
          {formatClock(total)}
        </span>
        {budget !== undefined ? (
          <span style={{ ...textCss(theme, 'hud'), color: theme.colours.ink.muted }}>
            / {formatClock(budget)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

type SegmentProps = {
  theme: Theme;
  segment: Segment;
  part: PartState;
  left: number;
  width: number;
  fill: number;
};

function SegmentView({ theme, segment, part, left, width, fill }: SegmentProps) {
  const rejected = part.actions.reject ?? 0;
  const semantic = rejected > 0 ? 'problem' : segment.semantic;
  const tint = semanticTint(theme, semantic);
  const strength = Math.max(part.emphasis, rejected);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...textCss(theme, 'label'),
        position: 'absolute',
        top: 0,
        bottom: 0,
        left,
        width: width * fill,
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        whiteSpace: 'nowrap',
        background: semanticFill(theme, semantic, WASH + (WASH_STRONG - WASH) * strength),
        border: `${emphasisStroke(theme, theme.stroke.regular, part)}px solid ${tint.border}`,
        color: theme.colours.ink.primary,
        opacity: dimOpacity(part.dimmed),
        boxShadow: emphasisShadow(theme, tint, part.emphasis),
        zIndex: part.emphasis > EMPHASIS_THRESHOLD ? 1 : 0,
      }}
    >
      <BoxMark theme={theme} levels={markLevels(part)} radius={0} />
      {segment.label}
    </div>
  );
}

function SpareStretch({ theme, left, width }: { theme: Theme; left: number; width: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left,
        width,
        boxSizing: 'border-box',
        border: `${theme.stroke.thin}px dashed ${theme.colours.line}`,
      }}
    />
  );
}

/** Time past the budget: hatched red over the segments it covers. */
function Overflow({ theme, left, right }: { theme: Theme; left: number; right: number }) {
  const hatch = semanticFill(theme, 'problem', 0.5);
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left,
        width: Math.max(0, right - left),
        background: `repeating-linear-gradient(45deg, ${hatch} 0 10px, transparent 10px 20px)`,
        zIndex: 2,
      }}
    />
  );
}

function BudgetMarker({ theme, x }: { theme: Theme; x: number }) {
  const tint = semanticTint(theme, 'focus');
  return (
    <div
      style={{
        position: 'absolute',
        top: -theme.space.xs,
        bottom: -theme.space.xs,
        left: x - theme.stroke.bold / 2,
        width: theme.stroke.bold,
        borderRadius: theme.stroke.bold,
        background: tint.base,
        boxShadow: tint.glowShadow,
        zIndex: 3,
      }}
    />
  );
}
