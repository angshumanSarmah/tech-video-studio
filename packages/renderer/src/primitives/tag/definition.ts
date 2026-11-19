import { z } from 'zod';
import { PinSchema, pinRefs } from '../common-props.ts';
import { SEMANTIC_COLOURS, type Theme } from '../../theme/index.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const TAG_MAX_LENGTH = 32;

export const TagPropsSchema = z.strictObject({
  pin: PinSchema.optional(),
  text: z
    .string()
    .trim()
    .min(1)
    .max(TAG_MAX_LENGTH)
    .describe('Short label, shown in uppercase monospace.'),
  semantic: z
    .enum(SEMANTIC_COLOURS)
    .default('neutral')
    .describe('Colour meaning: neutral label, focus, ok, problem or concept.'),
});
export type TagProps = z.output<typeof TagPropsSchema>;

export function tagSizeHints(props: TagProps, theme: Theme): SizeHints {
  const { space, stroke } = theme;
  const width = approxTextWidth(theme, 'tag', props.text) + 2 * (space.md + stroke.regular);
  const height = lineHeightPx(theme, 'tag') + 2 * (space.sm + stroke.regular);
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const tagPrimitive = definePrimitive({
  id: 'tag',
  family: 'annotation',
  propsSchema: TagPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse', 'reject'],
  sizeHints: tagSizeHints,
  elementRefs: (props) => pinRefs(props.pin),
  description: {
    summary:
      'A boxed monospace label in a semantic colour, like a sticker on the board. It names a ' +
      'thing, a state or a result in two or three words ("429", "CACHE HIT", "RATE LIMITED").',
    whenToUse:
      'Labelling a state, outcome or status code; calling out the key term of the beat; marking ' +
      'a result as ok or problem. `reject` turns it red with a cross. ' +
      'Set `pin` to keep it on a side of the element it belongs to.',
    whenNotToUse:
      'Sentences or explanations (the narration and headline carry those); numbers that change ' +
      '(use `counter`); a component or service in a system diagram.',
  },
  example: { props: { text: '<example-label>', semantic: 'problem' } },
});
