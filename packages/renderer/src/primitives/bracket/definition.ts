import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { elementRefList, lineText, PartIdSchema, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type ElementRef, type SizeHints } from '../types.ts';

export const BracketPropsSchema = z
  .strictObject({
    targets: elementRefList(
      { min: 1, max: 8 },
      'Ids of the sibling elements the brace groups, in display order (a run next to each other).',
    ),
    parts: z
      .array(PartIdSchema)
      .min(1)
      .max(12)
      .refine((ids) => new Set(ids).size === ids.length, 'Each part id at most once.')
      .optional()
      .describe('Optional: group only these parts (rows, slots) of a single target.'),
    label: lineText(16, 'Short label at the brace tip, e.g. FEATURES.'),
    semantic: semanticProp('neutral', 'Brace and label colour'),
  })
  .refine((p) => !p.parts || p.targets.length === 1, {
    message: 'parts groups parts of one element: give exactly one target.',
    path: ['parts'],
  });
export type BracketProps = z.output<typeof BracketPropsSchema>;

/** Brace depth (ends to tip) in px. */
export const BRACE_DEPTH = 40;
const MIN_SPAN = 320;

export function bracketSizeHints(props: BracketProps, theme: Theme): SizeHints {
  const label = approxTextWidth(theme, 'tag', props.label) + 2 * theme.space.md;
  const width = Math.max(MIN_SPAN, label);
  const height = BRACE_DEPTH + theme.space.sm + lineHeightPx(theme, 'tag') + theme.stroke.bold;
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export function bracketRefs(props: BracketProps): ElementRef[] {
  return props.targets.map((id, i) => ({
    path: ['targets', i],
    id,
    ...(props.parts ? { parts: props.parts } : {}),
  }));
}

export const bracketPrimitive = definePrimitive({
  id: 'bracket',
  family: 'annotation',
  propsSchema: BracketPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: bracketSizeHints,
  elementRefs: bracketRefs,
  description: {
    summary:
      'A curly brace that groups a run of sibling elements (`targets`), or some `parts` of ' +
      'one target, with a short `label` at its tip. `enter` draws the brace on, then the label ' +
      'fades in.',
    whenToUse:
      'Naming a group: the rows that are a model’s FEATURES, the three replicas that form ' +
      'a QUORUM, the slots that make one BATCH.',
    whenNotToUse:
      'A status on one element (use `tag`); an area on a map (use `zone_polygon`); a link ' +
      'between two elements (use `connector`).',
  },
  example: {
    props: { targets: ['example-rows'], parts: ['example-part'], label: '<example-group>' },
  },
});
