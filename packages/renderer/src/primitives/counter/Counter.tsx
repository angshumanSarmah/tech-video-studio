import { semanticTint, textCss } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import type { CounterProps } from './definition.ts';
import { countValueAt, formatCount } from './format.ts';

/** Big number with unit and caption. Shows `value`, or counts from `from` once `count` starts. */
export function Counter({ theme, props, box, state }: PrimitiveComponentProps<CounterProps>) {
  const tint = semanticTint(theme, props.semantic);
  const shown = displayedValue(props, state.actions.count);
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
        gap: theme.space.xs,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space.sm }}>
        <span
          style={{
            ...textCss(theme, 'metric'),
            color: tint.base,
            fontVariantNumeric: 'tabular-nums',
            textShadow: state.emphasis > 0.05 ? tint.glowShadow : 'none',
          }}
        >
          {formatCount(shown, theme.numberLocale, props.decimals)}
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

/** `from` (or `value` when unset) until `count` starts, then counting from `from` (default 0). */
function displayedValue(props: CounterProps, countProgress: number | undefined): number {
  if (countProgress === undefined) return props.from ?? props.value;
  return countValueAt(props.from ?? 0, props.value, countProgress, props.decimals);
}
