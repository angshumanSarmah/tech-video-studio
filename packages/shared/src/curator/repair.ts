import { z } from 'zod';
import { SpecIdSchema } from '../spec/ids.ts';
import { FixFieldSchema } from './review.ts';
import { LlmUsageSchema } from './usage.ts';

/**
 * The Curator's repairs of single beats (P1C.8): what a repair is asked to fix, and what it did.
 * A request goes to the agent that owns the problem: the Scriptwriter (a beat's narration or
 * on-screen text) or the Generator (its board). Step files of the `repair` stage.
 */

export const RepairIssueSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  quotes: z.array(z.string().min(1)).optional(),
});
export type RepairIssueInput = z.infer<typeof RepairIssueSchema>;

export const RepairRequestSchema = z.strictObject({
  beatId: SpecIdSchema,
  owner: z.enum(['scriptwriter', 'generator']),
  /** What the fix may change: Scriptwriter fields, or `board`. */
  fields: z.array(FixFieldSchema).min(1),
  issues: z.array(RepairIssueSchema).min(1),
});
export type RepairRequest = z.infer<typeof RepairRequestSchema>;

export const RepairInputSchema = z.strictObject({
  specVersionId: z.number().int().positive(),
  version: z.number().int().positive(),
  requests: z.array(RepairRequestSchema).min(1),
});
export type RepairInput = z.infer<typeof RepairInputSchema>;

/** What a beat's board became: as it was, its anchors moved, or drawn again. */
export const BOARD_OUTCOMES = ['kept', 'remapped', 'redrawn'] as const;

export const RepairOutputSchema = z.strictObject({
  specVersionId: z.number().int().positive(),
  version: z.number().int().positive(),
  /** False when the repaired spec equals the latest version (nothing was saved). */
  created: z.boolean(),
  beats: z.array(
    z.strictObject({
      beatId: SpecIdSchema,
      script: z.enum(['kept', 'revised']),
      board: z.enum(BOARD_OUTCOMES),
      narration: z.strictObject({ before: z.string(), after: z.string() }).optional(),
      /** Anchored words the new narration dropped (the board was drawn again). */
      lost: z.array(z.string()).optional(),
    }),
  ),
  usage: LlmUsageSchema,
});
export type RepairOutput = z.infer<typeof RepairOutputSchema>;
