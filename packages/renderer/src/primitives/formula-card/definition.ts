import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { lineText, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';
import { LATEX_MAX_LENGTH, latexProblem } from './latex.ts';
import { estimateLatexExtent } from './latex-size.ts';

export const FormulaCardPropsSchema = z.strictObject({
  latex: z
    .string()
    .trim()
    .min(1)
    .max(LATEX_MAX_LENGTH)
    .superRefine((latex, ctx) => {
      const problem = latexProblem(latex);
      if (problem) ctx.addIssue({ code: 'custom', message: `Invalid LaTeX: ${problem}` });
    })
    .describe('One formula in LaTeX math mode, without $ delimiters. Rendered by KaTeX.'),
  caption: lineText(48, 'Optional plain-words reading of the formula, shown under it.').optional(),
  semantic: semanticProp('concept', 'Border and glow colour'),
});
export type FormulaCardProps = z.output<typeof FormulaCardPropsSchema>;

/** Formula font size in px: the headline size, so it reads like a statement. */
export function formulaFontSize(theme: Theme): number {
  return theme.text.headline.size;
}

export function formulaCardSizeHints(props: FormulaCardProps, theme: Theme): SizeHints {
  const { space, stroke } = theme;
  const extent = estimateLatexExtent(props.latex);
  const font = formulaFontSize(theme);
  const caption = props.caption ? approxTextWidth(theme, 'label', props.caption) : 0;
  const width =
    Math.ceil(Math.max(extent.widthEm * font, caption)) + 2 * (space.lg + stroke.regular);
  const captionHeight = props.caption ? space.sm + lineHeightPx(theme, 'label') : 0;
  const height =
    Math.ceil(extent.heightEm * font) + captionHeight + 2 * (space.md + stroke.regular);
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const formulaCardPrimitive = definePrimitive({
  id: 'formula_card',
  family: 'data',
  propsSchema: FormulaCardPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: formulaCardSizeHints,
  description: {
    summary:
      'A card with one typeset formula (LaTeX, rendered by KaTeX) and an optional caption that ' +
      'reads it in plain words. At most 80 characters of LaTeX; invalid LaTeX is a spec error.',
    whenToUse:
      'The one formula a topic genuinely rests on: attention scores, a hit ratio, the hash ring ' +
      'position. At most one per video, and only when the narration walks through it.',
    whenNotToUse:
      'A single number (use `counter` or `stat_card`); an equation the narration never ' +
      'explains; code or data (use `data_block`).',
  },
  example: {
    props: {
      latex: '\\text{<example-term>} = \\frac{a}{a + b}',
      caption: '<example-reading>',
    },
  },
});
