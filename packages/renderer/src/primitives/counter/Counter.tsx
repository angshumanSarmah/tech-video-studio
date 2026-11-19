import { emphasisShadow, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark, FocusUnderline } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import type { CounterProps } from './definition.ts';
import { counterValue, formatCount } from './format.ts';

/** Big number with unit and caption; what it shows comes from `counterValue`. */
export function Counter({ theme, props, box, state }: PrimitiveComponentProps<CounterProps>) {
  const tint = semanticTint(theme, props.semantic);
  const shown = counterValue(props, state.actions.count);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...stateStyle(state),
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
          <FocusUnderline theme={theme} semantic={props.semantic} highlight={state.highlight}>
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
