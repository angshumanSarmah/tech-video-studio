import { useMemo } from 'react';
import { semanticTint, textCss } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { cardSurfaceCss } from '../surface.ts';
import { formulaFontSize, type FormulaCardProps } from './definition.ts';
import { useKatexFonts } from './katex-fonts.ts';
import { renderLatex } from './latex.ts';

/** Typeset formula on a card. Props passed their schema, so the LaTeX is known to render. */
export function FormulaCard({
  theme,
  props,
  box,
  state,
}: PrimitiveComponentProps<FormulaCardProps>) {
  useKatexFonts();
  const tint = semanticTint(theme, props.semantic);
  // KaTeX output, from LaTeX rendered with `trust: false` (no links, HTML or styles).
  const html = useMemo(() => ({ __html: renderLatex(props.latex) }), [props.latex]);
  return (
    <div
      style={{
        ...stateStyle(state),
        ...cardSurfaceCss(theme, tint, state),
        width: box.width,
        height: box.height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.sm,
        padding: `0 ${theme.space.lg}px`,
      }}
    >
      <div
        // KaTeX's inline mode may break lines after relations; a formula stays on one line.
        style={{
          fontSize: formulaFontSize(theme),
          color: theme.colours.ink.primary,
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
        dangerouslySetInnerHTML={html}
      />
      {props.caption ? (
        <div
          style={{
            ...textCss(theme, 'label'),
            color: theme.colours.ink.muted,
            whiteSpace: 'nowrap',
          }}
        >
          {props.caption}
        </div>
      ) : null}
    </div>
  );
}
