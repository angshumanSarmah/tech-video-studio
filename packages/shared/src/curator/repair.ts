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
  /**
   * The active style rules the repair's agents read (P1C.10), once for the whole repair. Absent
   * in steps from before rules reached repairs.
   */
  styleRules: z
    .strictObject({ scriptwriter: z.array(z.string()), generator: z.array(z.string()) })
    .optional(),
  /**
   * The gate decision this repair carries out (a person's "regenerate beat N"): its `gate` event
   * id, so the gate can report what the regenerate did (`regenerateOutcomes`). Absent for the
   * Curator's own repairs.
   */
  decisionEventId: z.number().int().positive().optional(),
});
export type RepairInput = z.infer<typeof RepairInputSchema>;

/** What one repair request did: something changed, or nothing did (and why). */
export const REQUEST_OUTCOMES = ['changed', 'unchanged'] as const;

export const RepairRequestOutcomeSchema = z.strictObject({
  beatId: SpecIdSchema,
  owner: z.enum(['scriptwriter', 'generator']),
  fields: z.array(FixFieldSchema).min(1),
  outcome: z.enum(REQUEST_OUTCOMES),
  /** Why nothing changed (only with `unchanged`). */
  reason: z.string().min(1).optional(),
});
export type RepairRequestOutcome = z.infer<typeof RepairRequestOutcomeSchema>;

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
  /** Each request's outcome, in request order. Absent in steps from before outcomes existed. */
  requests: z.array(RepairRequestOutcomeSchema).optional(),
});
export type RepairOutput = z.infer<typeof RepairOutputSchema>;
