import { semanticTint, textCss } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { formatCount } from '../counter/format.ts';
import { emphasisShadow, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark, FocusUnderline } from '../../emphasis/Mark.tsx';
import { fromText, TRANSITION_ARROW, type CounterTransitionProps } from './definition.ts';
import { transitionView } from './transition.ts';

/** How far `to` slides in from, in em of the metric text. */
const SHIFT_EM = 0.5;

/** "from → to" with a colour change; what is visible comes from `transitionView`. */
export function CounterTransition({
  theme,
  props,
  box,
  state,
}: PrimitiveComponentProps<CounterTransitionProps>) {
  const view = transitionView(state.actions.count);
  const fromTint = semanticTint(theme, props.fromSemantic);
  const toTint = semanticTint(theme, props.toSemantic);
  const metric = textCss(theme, 'metric');
  const digits = (n: number) => formatCount(n, theme.numberLocale, props.decimals);
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space.md }}>
        <span style={{ ...metric, color: fromTint.base, opacity: view.fromStrength }}>
          <FocusUnderline theme={theme} semantic={props.fromSemantic} highlight={state.highlight}>
            {fromText(props, theme.numberLocale)}
          </FocusUnderline>
        </span>
        <span style={{ ...metric, color: theme.colours.ink.muted, opacity: view.arrow }}>
          {TRANSITION_ARROW}
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: theme.space.sm,
            opacity: view.to,
            transform: `translateX(${-view.toShift * theme.text.metric.size * SHIFT_EM}px)`,
          }}
        >
          <span
            style={{
              ...metric,
              color: toTint.base,
              fontVariantNumeric: 'tabular-nums',
              textShadow: emphasisShadow(theme, toTint, state.emphasis),
            }}
          >
            <FocusUnderline theme={theme} semantic={props.toSemantic} highlight={state.highlight}>
              {digits(props.to)}
            </FocusUnderline>
          </span>
          {props.unit ? (
            <span style={{ ...textCss(theme, 'label'), color: theme.colours.ink.muted }}>
              {props.unit}
            </span>
          ) : null}
        </span>
      </div>
      {props.label ? (
        <div style={{ ...textCss(theme, 'label'), color: theme.colours.ink.muted }}>
          {props.label}
        </div>
      ) : null}
    </div>
  );
}
