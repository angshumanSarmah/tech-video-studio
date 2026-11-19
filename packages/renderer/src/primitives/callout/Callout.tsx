import { emphasisShadow, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss } from '../../theme/index.ts';
import { Badge } from '../badge.tsx';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { shakeOffset } from '../motion.ts';
import { cardSurfaceCss } from '../surface.ts';
import type { CalloutProps } from './definition.ts';

/** A what-if or warning card; `reject` turns it red, shakes and shows ✗. */
export function Callout({ theme, props, box, state }: PrimitiveComponentProps<CalloutProps>) {
  const rejected = state.actions.reject ?? 0;
  const tint = semanticTint(theme, rejected > 0 ? 'problem' : props.semantic);
  const base = stateStyle(state);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...base,
        ...cardSurfaceCss(theme, tint, state),
        transform: `${base.transform} translateX(${shakeOffset(rejected, theme.space.sm)}px)`,
        position: 'relative',
        width: box.width,
        height: box.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: theme.space.xs,
        padding: `0 ${theme.space.md}px`,
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.md} size={box} />
      {props.title ? (
        <div
          style={{
            ...textCss(theme, 'label'),
            color: tint.base,
            textShadow: emphasisShadow(theme, tint, state.emphasis),
          }}
        >
          {props.title}
        </div>
      ) : null}
      <div style={{ ...textCss(theme, 'body'), color: theme.colours.ink.primary }}>
        {props.text}
      </div>
      {rejected > 0 ? (
        <Badge theme={theme} colour={tint.base} opacity={rejected}>
          ✗
        </Badge>
      ) : null}
    </div>
  );
}
