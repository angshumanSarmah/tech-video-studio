import { markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { cardSurfaceCss, NO_WRAP } from '../surface.ts';
import { typedCommandChars } from '../typing.ts';
import { splitCommand, visibleCommand } from './command.ts';
import { CARET_EM, type CommandBubbleProps } from './definition.ts';

/** One-line command in a speech bubble; types out after `enter`, red with ✗ on `reject`. */
export function CommandBubble({
  theme,
  props,
  box,
  state,
}: PrimitiveComponentProps<CommandBubbleProps>) {
  const rejected = state.actions.reject ?? 0;
  const tint = semanticTint(theme, rejected > 0 ? 'problem' : props.semantic);
  const chars = typedCommandChars(props.text.length, state.elapsed.enter);
  const shown = visibleCommand(splitCommand(props.text), chars);
  const tail = theme.space.sm * 1.5;
  return (
    <div
      style={{
        ...stateStyle(state),
        width: box.width,
        height: box.height,
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          ...markHostCss(theme),
          ...cardSurfaceCss(theme, tint, state),
          ...textCss(theme, 'data'),
          ...NO_WRAP,
          position: 'relative',
          width: '100%',
          height: box.height - theme.space.sm,
          borderRadius: theme.radius.lg,
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${theme.space.md}px`,
          color: theme.colours.ink.primary,
          overflow: 'visible',
        }}
      >
        <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.lg} size={box} />
        <span style={{ color: tint.base, fontWeight: 700 }}>{shown.verb}</span>
        <span>{shown.rest}</span>
        {chars < props.text.length ? (
          <span
            style={{
              display: 'inline-block',
              width: `${CARET_EM}em`,
              height: '1em',
              background: tint.base,
            }}
          />
        ) : null}
        {rejected > 0 ? (
          <span style={{ color: tint.base, marginLeft: theme.space.sm, opacity: rejected }}>✗</span>
        ) : null}
      </div>
      {/* Tail: a small rotated square under the bubble's lower-left corner. */}
      <div
        style={{
          position: 'absolute',
          left: theme.space.lg,
          bottom: theme.space.sm - tail / 2 + theme.stroke.regular,
          width: tail,
          height: tail,
          transform: 'rotate(45deg)',
          background: `linear-gradient(${tint.soft}, ${tint.soft}) ${theme.colours.surface}`,
          borderRight: `${theme.stroke.regular}px solid ${tint.border}`,
          borderBottom: `${theme.stroke.regular}px solid ${tint.border}`,
        }}
      />
    </div>
  );
}
