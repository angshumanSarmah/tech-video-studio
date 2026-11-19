import { emphasisShadow, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss } from '../../theme/index.ts';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { zoomView } from '../overlay.ts';
import { cardSurfaceCss } from '../surface.ts';
import { insetHeaderHeight, type InsetPanelProps } from './definition.ts';

/**
 * A detail card over the dimmed scene, holding its (already drawn and placed) children. It zooms
 * from its own centre; zooming out of its anchor's placed box is in docs/TODO.md.
 */
export function InsetPanel({
  theme,
  props,
  box,
  state,
  children,
}: PrimitiveComponentProps<InsetPanelProps>) {
  const tint = semanticTint(theme, props.semantic);
  const zoom = zoomView(state);
  const header = insetHeaderHeight(props, theme);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...cardSurfaceCss(theme, tint, state, { wash: false }),
        position: 'relative',
        width: box.width,
        height: box.height,
        opacity: zoom.opacity,
        transform: zoom.transform,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.md} size={box} />
      {props.title ? (
        <div
          style={{
            ...textCss(theme, 'label'),
            height: header,
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            padding: `0 ${theme.space.md}px`,
            borderBottom: `${theme.stroke.hairline}px solid ${tint.border}`,
            color: props.semantic === 'neutral' ? theme.colours.ink.muted : tint.base,
            textShadow: emphasisShadow(theme, tint, state.emphasis),
          }}
        >
          {props.title}
        </div>
      ) : null}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignContent: 'center',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.space.lg,
          padding: theme.space.lg,
        }}
      >
        {children}
      </div>
    </div>
  );
}
