import { emphasisShadow, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark, FocusUnderline } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { shakeOffset } from '../motion.ts';
import type { CounterProps } from './definition.ts';
import { counterValue, formatCount, tickProgress } from './format.ts';

/**
 * Big number with unit and caption; what it shows comes from `counterValue`. A `ticking` count
 * follows narration time (`tickProgress`); `reject` turns the number red with a shake.
 */
export function Counter({ theme, props, box, state }: PrimitiveComponentProps<CounterProps>) {
  const rejected = state.actions.reject ?? 0;
  const semantic = rejected > 0 ? 'problem' : props.semantic;
  const tint = semanticTint(theme, semantic);
  const progress = props.ticking
    ? tickProgress(state.elapsed.count, state.runSec.count)
    : state.actions.count;
  const shown = counterValue(props, progress);
  const base = stateStyle(state);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...base,
        transform: `${base.transform} translateX(${shakeOffset(rejected, theme.space.sm)}px)`,
        width: box.width,
        height: box.height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.xs,
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space.sm }}>
        <span
          style={{
            ...textCss(theme, 'metric'),
            color: tint.base,
            fontVariantNumeric: 'tabular-nums',
            textShadow: emphasisShadow(theme, tint, state.emphasis),
          }}
        >
          <FocusUnderline theme={theme} semantic={semantic} highlight={state.highlight}>
            {formatCount(shown, theme.numberLocale, props.decimals)}
          </FocusUnderline>
        </span>
        {props.unit ? (
          <span style={{ ...textCss(theme, 'label'), color: theme.colours.ink.muted }}>
            {props.unit}
          </span>
        ) : null}
      </div>
      {props.label ? (
        <div style={{ ...textCss(theme, 'label'), color: theme.colours.ink.muted }}>
          {props.label}
        </div>
      ) : null}
    </div>
  );
}
