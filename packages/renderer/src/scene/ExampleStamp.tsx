import { rectCss } from '../layers/rect-css.ts';
import { semanticTint, textCss, type Rect, type Theme } from '../theme/index.ts';
import { EXAMPLE_STAMP_STYLE, EXAMPLE_STAMP_TEXT } from './example-stamp.ts';

type Props = { theme: Theme; rect: Rect; opacity: number };

/**
 * The EXAMPLE stamp in its reserved band (`exampleStampBand`). Title-block themes draw a ruled
 * box in muted ink, like a drawing's stamp; bar themes a soft rounded pill. Fades in with the
 * footnote.
 */
export function ExampleStamp({ theme, rect, opacity }: Props) {
  if (opacity <= 0) return null;
  const ruled = theme.hud.style === 'title-block';
  const tint = semanticTint(theme, 'neutral');
  return (
    <div
      data-testid="example-stamp"
      style={{
        ...rectCss(rect),
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...textCss(theme, EXAMPLE_STAMP_STYLE),
        color: theme.colours.ink.muted,
        border: `${theme.stroke.thin}px solid ${ruled ? theme.colours.ink.muted : tint.border}`,
        borderRadius: ruled ? 0 : rect.height / 2,
        background: ruled ? 'transparent' : tint.soft,
        whiteSpace: 'nowrap',
        opacity,
      }}
    >
      {EXAMPLE_STAMP_TEXT}
    </div>
  );
}
