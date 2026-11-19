import { emphasisShadow, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark, FocusUnderline } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { cardSurfaceCss } from '../surface.ts';
import { SOURCE_PREFIX, type StatCardProps } from './definition.ts';

/** Big cited figure, its label, and the source as a footnote. */
export function StatCard({ theme, props, box, state }: PrimitiveComponentProps<StatCardProps>) {
  const tint = semanticTint(theme, props.semantic);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...stateStyle(state),
        ...cardSurfaceCss(theme, tint, state, { wash: false }),
        width: box.width,
        height: box.height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `0 ${theme.space.lg}px`,
        whiteSpace: 'nowrap',
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.md} size={box} />
      <div
        style={{
          ...textCss(theme, 'metric'),
          color: tint.base,
          textShadow: emphasisShadow(theme, tint, state.emphasis),
        }}
      >
        <FocusUnderline theme={theme} semantic={props.semantic} highlight={state.highlight}>
          {props.value}
        </FocusUnderline>
      </div>
      <div
        style={{
          ...textCss(theme, 'label'),
          color: theme.colours.ink.primary,
          marginTop: theme.space.xs,
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          ...textCss(theme, 'footnote'),
          color: theme.colours.ink.faint,
          marginTop: theme.space.md,
        }}
      >
        {SOURCE_PREFIX}
        {props.source}
      </div>
    </div>
  );
}
