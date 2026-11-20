import { z } from 'zod';
import { ResearchNumberIdSchema } from '../research/notes.ts';
import { SpecIdSchema } from '../spec/ids.ts';
import { HeadlineSemanticSchema, SourceLineSchema } from '../spec/script.ts';
import {
  MAX_STAT_CARDS_PER_BEAT,
  MAX_STAT_CARDS_PER_VIDEO,
  MAX_TAGS_PER_BEAT,
  ON_SCREEN_TEXT_LIMITS,
} from './limits.ts';

/**
 * The Scriptwriter's output (P1C.6): the spec's Script layer, one entry per story beat in story
 * order, wrapped in an object (JSON mode answers objects). Stricter than `BeatScriptSchema`: on-
 * screen text carries the limits of the primitives that show it, stat cards cite research number
 * ids, and the headline's anchor is left to its default. Descriptions reach the model through
 * the output JSON Schema, so they are written to it.
 */

const L = ON_SCREEN_TEXT_LIMITS;

/** One line of at most `max` characters. */
function line(max: number, description: string) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\n\r]*$/, 'One line, without line breaks.')
    .describe(description);
}

export const ScriptwriterHeadlineSchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1)
    .describe(
      'About 5 words stating the takeaway, not repeating the narration; for concept beats "<example-term> = <example-plain-meaning>".',
    ),
  semantic: HeadlineSemanticSchema.describe(
    'concept (a term or idea), decision (a design choice), problem (what breaks) or resolution (the fix).',
  ),
});

export const ScriptwriterStatCardSchema = z.strictObject({
  value: line(
    L.statValue,
    'The research number as displayed, units included, e.g. "<example-value><example-unit>".',
  ),
  label: line(L.statLabel, 'What the figure measures, short.'),
  sourceRef: ResearchNumberIdSchema.describe('The research number id ("num-<n>") it shows.'),
});

export const ScriptwriterBeatSchema = z.strictObject({
  beatId: SpecIdSchema.describe("The plan beat's id; one entry per beat, in the plan's order."),
  narration: z
    .string()
    .trim()
    .min(1)
    .describe(
      'The spoken words of the beat, within its word budget: short sentences, numbers spelled as spoken.',
    ),
  headline: ScriptwriterHeadlineSchema.optional(),
  tags: z
    .array(line(L.tag, 'A boxed label of two or three words.'))
    .max(MAX_TAGS_PER_BEAT)
    .default([])
    .describe(
      "Short on-screen labels for states, outcomes or the key term; never a stat card's number.",
    ),
  statCards: z
    .array(ScriptwriterStatCardSchema)
    .default([])
    .describe(
      `Cards for research numbers only, each citing its number id: at most ${MAX_STAT_CARDS_PER_BEAT} per beat and ${MAX_STAT_CARDS_PER_VIDEO} per video, each number also said in the beat's narration.`,
    ),
  formulaCard: z
    .strictObject({
      latex: z
        .string()
        .trim()
        .min(1)
        .max(L.latex)
        .describe('One formula in LaTeX math mode, without $ delimiters.'),
      caption: line(L.formulaCaption, 'The formula read in plain words.').optional(),
    })
    .optional()
    .describe('At most one per video, only when the narration walks through the formula.'),
  commandBubble: z
    .strictObject({ text: line(L.command, 'The command exactly as typed, on one line.') })
    .optional()
    .describe('One command a component sends another, when the command itself teaches.'),
  source: SourceLineSchema.optional().describe(
    'Footnote ("Source: " is added) for a beat that shows a real incident or a sourced number: the plan beat\'s source, else the research source of its stat cards.',
  ),
});
export type ScriptwriterBeat = z.infer<typeof ScriptwriterBeatSchema>;

export const ScriptwriterOutputSchema = z.strictObject({
  script: z.array(ScriptwriterBeatSchema).min(1),
});
export type ScriptwriterOutput = z.infer<typeof ScriptwriterOutputSchema>;
