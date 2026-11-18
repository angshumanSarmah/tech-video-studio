import { semanticTint, textCss } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { GLOW_THRESHOLD } from '../surface.ts';
import { timerDigitsSize, timerRingDiameter, type TimerRingProps } from './definition.ts';
import { formatClock, timerView } from './timer.ts';

/** Peak opacity of the expiry flash over the ring's face. */
const FLASH_ALPHA = 0.35;

/** Countdown ring; what it shows comes from `timerView`. */
export function TimerRing({ theme, props, box, state }: PrimitiveComponentProps<TimerRingProps>) {
  const view = timerView({
    durationSec: props.durationSec,
    speed: props.speed,
    countElapsed: state.elapsed.count,
    rejectProgress: state.actions.reject,
  });
  const tint = semanticTint(theme, view.expired ? 'problem' : props.semantic);
  const diameter = timerRingDiameter(theme);
  const stroke = theme.stroke.bold * 2;
  const r = (diameter - stroke) / 2;
  const c = diameter / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <div
      style={{
        ...stateStyle(state),
        width: box.width,
        height: box.height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.sm,
      }}
    >
      <div style={{ position: 'relative', width: diameter, height: diameter }}>
        <svg
          width={diameter}
          height={diameter}
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        >
          <g style={{ filter: view.flash > GLOW_THRESHOLD ? tint.glowFilter : undefined }}>
            <circle
              cx={c}
              cy={c}
              r={r}
              fill={theme.colours.surface}
              stroke={view.expired ? tint.border : theme.colours.line}
              strokeWidth={stroke}
            />
          </g>
          {/* The expiry flash washes the face in the problem colour. */}
          <circle cx={c} cy={c} r={r} fill={tint.base} fillOpacity={FLASH_ALPHA * view.flash} />
          {view.fraction > 0 ? (
            // A round cap would leave a dot at 0, so an empty ring draws no arc at all.
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={tint.base}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${circumference * view.fraction} ${circumference}`}
              transform={`rotate(-90 ${c} ${c})`}
              style={{ filter: state.emphasis > GLOW_THRESHOLD ? tint.glowFilter : undefined }}
            />
          ) : null}
        </svg>
        <div
          style={{
            ...textCss(theme, 'metric'),
            fontSize: timerDigitsSize(theme),
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontVariantNumeric: 'tabular-nums',
            color: view.expired ? tint.base : theme.colours.ink.primary,
          }}
        >
          {formatClock(view.shownSec)}
        </div>
      </div>
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
