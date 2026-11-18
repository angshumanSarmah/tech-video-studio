import { semanticTint, textCss } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { cardSurfaceCss, GLOW_THRESHOLD } from '../surface.ts';
import { SOURCE_PREFIX, type StatCardProps } from './definition.ts';

/** Big cited figure, its label, and the source as a footnote. */
export function StatCard({ theme, props, box, state }: PrimitiveComponentProps<StatCardProps>) {
  const tint = semanticTint(theme, props.semantic);
  return (
    <div
      style={{
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
      <div
        style={{
          ...textCss(theme, 'metric'),
          color: tint.base,
          textShadow: state.emphasis > GLOW_THRESHOLD ? tint.glowShadow : 'none',
        }}
      >
        {props.value}
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
