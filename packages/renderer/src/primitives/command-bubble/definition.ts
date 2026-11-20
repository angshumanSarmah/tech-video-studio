import { ON_SCREEN_TEXT_LIMITS } from '@explainer-studio/shared';
import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { lineText, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const COMMAND_MAX_LENGTH = ON_SCREEN_TEXT_LIMITS.command;

export const CommandBubblePropsSchema = z.strictObject({
  text: lineText(COMMAND_MAX_LENGTH, 'The command exactly as typed, on one line.'),
  semantic: semanticProp('concept', 'Colour of the bubble and the command verb'),
});
export type CommandBubbleProps = z.output<typeof CommandBubblePropsSchema>;

/** Caret width in em of the data text. */
export const CARET_EM = 0.6;

export function commandBubbleSizeHints(props: CommandBubbleProps, theme: Theme): SizeHints {
  const { space, stroke } = theme;
  const caret = Math.ceil(theme.text.data.size * CARET_EM);
  const cross = space.sm + approxTextWidth(theme, 'data', 'x');
  const width =
    approxTextWidth(theme, 'data', props.text) + caret + cross + 2 * (space.md + stroke.regular);
  const height = lineHeightPx(theme, 'data') + 2 * (space.sm + stroke.regular) + space.sm;
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const commandBubblePrimitive = definePrimitive({
  id: 'command_bubble',
  family: 'data',
  propsSchema: CommandBubblePropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse', 'reject'],
  sizeHints: commandBubbleSizeHints,
  description: {
    summary:
      'A speech bubble holding one line of monospace command, with the verb coloured, such as a ' +
      'key/value store command or a CLI call. On `enter` the command types itself out (about ' +
      '30 characters a second, never more than 1.5 s). `reject` turns it red with a cross.',
    whenToUse:
      'The exact request one component sends another, when the command itself teaches ' +
      'something: what a client asks a cache, what a producer writes to a log.',
    whenNotToUse:
      'Data at rest (use `data_block`); several lines or real code; a plain label (use `tag`).',
  },
  example: { props: { text: 'SET <example-key> "<example-value>"' } },
});
