import { z } from 'zod';
import { SpecIdSchema } from './ids.ts';

/** Script layer, written by the Scriptwriter: one entry per story beat, in story order. */

export const HEADLINE_SEMANTICS = ['concept', 'decision', 'problem', 'resolution'] as const;
export const HeadlineSemanticSchema = z.enum(HEADLINE_SEMANTICS);
export type HeadlineSemantic = z.infer<typeof HeadlineSemanticSchema>;

export const HeadlineSchema = z.strictObject({
  /** "X = plain meaning" style for concept beats. */
  text: z.string().min(1),
  semantic: HeadlineSemanticSchema,
});
export type Headline = z.infer<typeof HeadlineSchema>;

export const StatCardSchema = z.strictObject({
  /** Display value, kept as text so units and formatting survive (e.g. "10k/s"). */
  value: z.string().min(1),
  label: z.string().min(1),
  /** Research note id (resolved against research notes in P1C.6). */
  sourceRef: SpecIdSchema,
});
export type StatCard = z.infer<typeof StatCardSchema>;

export const FormulaCardSchema = z.strictObject({
  latex: z.string().min(1),
  caption: z.string().min(1).optional(),
});
export type FormulaCard = z.infer<typeof FormulaCardSchema>;

/** One-line command shown as data, e.g. a key/value store command. */
export const CommandBubbleSchema = z.strictObject({ text: z.string().min(1) });
export type CommandBubble = z.infer<typeof CommandBubbleSchema>;

export const BeatScriptSchema = z.strictObject({
  beatId: SpecIdSchema,
  narration: z.string().trim().min(1),
  headline: HeadlineSchema.optional(),
  tags: z.array(z.string().min(1)).default([]),
  statCards: z.array(StatCardSchema).default([]),
  /** At most one per video. */
  formulaCard: FormulaCardSchema.optional(),
  commandBubble: CommandBubbleSchema.optional(),
});
export type BeatScript = z.infer<typeof BeatScriptSchema>;

export const ScriptLayerSchema = z.array(BeatScriptSchema).min(1);
export type ScriptLayer = z.infer<typeof ScriptLayerSchema>;
