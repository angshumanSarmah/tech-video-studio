import { semanticTint, textCss, type Theme } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { GLOW_THRESHOLD } from '../surface.ts';
import { timerDigitsSize, timerRingDiameter, type TimerRingProps } from './definition.ts';
import { formatClock, speedLabel, timerView } from './timer.ts';

/** Peak opacity of the expiry flash over the ring's face. */
const FLASH_ALPHA = 0.35;

type SpeedTagProps = { theme: Theme; label: string | undefined; top: number; opacity: number };

/**
 * "⏩ 60×" under the digits once the clock runs faster than real time (from `count` on). The
 * fast-forward mark is drawn as SVG: no bundled font has U+23E9.
 */
function SpeedTag({ theme, label, top, opacity }: SpeedTagProps) {
  if (!label || opacity <= 0) return null;
  const size = theme.text.hud.size;
  return (
    <div
      style={{
        ...textCss(theme, 'hud'),
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.xs / 2,
        color: theme.colours.ink.muted,
        whiteSpace: 'nowrap',
        opacity,
      }}
    >
      <svg width={size} height={size * 0.7} viewBox="0 0 20 14" fill="currentColor">
        <path d="M0 0 L10 7 L0 14 Z M10 0 L20 7 L10 14 Z" />
      </svg>
      {label}
    </div>
  );
}

/** Countdown ring; what it shows comes from `timerView`. */
export function TimerRing({ theme, props, box, state }: PrimitiveComponentProps<TimerRingProps>) {
  const view = timerView({
    durationSec: props.durationSec,
    countElapsed: state.elapsed.count,
    countRunSec: state.runSec.count,
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
        <SpeedTag
          theme={theme}
          label={speedLabel(view.speed)}
          top={c + timerDigitsSize(theme) * 0.6}
          opacity={view.tagOpacity}
        />
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
