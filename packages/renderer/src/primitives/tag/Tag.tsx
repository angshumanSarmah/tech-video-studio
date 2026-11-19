import {
  emphasisShadow,
  emphasisStroke,
  markHostCss,
  markLevels,
} from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import type { TagProps } from './definition.ts';

/** Boxed monospace label. `reject` switches it to the problem colour and adds a cross. */
export function Tag({ theme, props, box, state }: PrimitiveComponentProps<TagProps>) {
  const rejected = state.actions.reject ?? 0;
  const tint = semanticTint(theme, rejected > 0 ? 'problem' : props.semantic);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...textCss(theme, 'tag'),
        ...stateStyle(state),
        width: box.width,
        height: box.height,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.xs,
        whiteSpace: 'nowrap',
        color: theme.colours.ink.primary,
        border: `${emphasisStroke(theme, theme.stroke.regular, state)}px solid ${tint.border}`,
        borderRadius: theme.radius.sm,
        background: tint.soft,
        boxShadow: emphasisShadow(theme, tint, state.emphasis),
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.sm} />
      {rejected > 0 ? <span style={{ color: tint.base, opacity: rejected }}>✗</span> : null}
      {props.text}
    </div>
  );
}
