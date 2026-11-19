import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { lineText } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const CALLOUT_SEMANTICS = ['problem', 'focus', 'concept'] as const;

export const CalloutPropsSchema = z.strictObject({
  title: lineText(20, 'Optional short heading above the text, e.g. WHAT IF.').optional(),
  text: lineText(64, 'The counterfactual or warning; wraps to at most two lines.'),
  semantic: z
    .enum(CALLOUT_SEMANTICS)
    .default('problem')
    .describe('Colour meaning: problem (a warning), focus (the point) or concept (an aside).'),
});
export type CalloutProps = z.output<typeof CalloutPropsSchema>;

/** Widest a callout grows before its text wraps (the second line takes the rest). */
const MAX_TEXT_WIDTH = 560;
const MIN_TEXT_WIDTH = 240;

/** Text lines the callout needs at its text width: one or two. */
export function calloutLines(props: CalloutProps, theme: Theme): number {
  return approxTextWidth(theme, 'body', props.text) > MAX_TEXT_WIDTH ? 2 : 1;
}

export function calloutSizeHints(props: CalloutProps, theme: Theme): SizeHints {
  const { space, stroke } = theme;
  const textWidth = Math.min(MAX_TEXT_WIDTH, approxTextWidth(theme, 'body', props.text));
  const titleWidth = props.title ? approxTextWidth(theme, 'label', props.title) : 0;
  const inner = Math.max(MIN_TEXT_WIDTH, textWidth, titleWidth);
  const title = props.title ? lineHeightPx(theme, 'label') + space.xs : 0;
  const width = inner + 2 * (space.md + stroke.regular);
  const height =
    title +
    calloutLines(props, theme) * lineHeightPx(theme, 'body') +
    2 * (space.md + stroke.regular);
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const calloutPrimitive = definePrimitive({
  id: 'callout',
  family: 'annotation',
  propsSchema: CalloutPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse', 'reject'],
  sizeHints: calloutSizeHints,
  description: {
    summary:
      'A small card with one or two lines of text and an optional `title`, for a counterfactual ' +
      'or a warning: "If prep takes 20 min: rider waits 17 min ✗". Tinted by `semantic`: ' +
      'problem, focus or concept. `reject` turns it red with a cross and a shake (the ' +
      'assumption it states is ruled out).',
    whenToUse:
      'A what-if, a caveat or a consequence that sits beside the diagram: the cost of the ' +
      'naive choice, a warning about a failure mode, an aside that explains a term.',
    whenNotToUse:
      'A one-word status (use `tag`); a big statement over the whole scene (use ' +
      '`statement_card`); a number with a source (use `stat_card`).',
  },
  example: {
    props: { title: '<example-heading>', text: '<example-what-if>', semantic: 'problem' },
  },
});
