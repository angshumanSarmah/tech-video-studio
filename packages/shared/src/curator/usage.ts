import { z } from 'zod';

/** Tokens and cost of a set of LLM calls (a review, a repair). */
export const LlmUsageSchema = z.strictObject({
  calls: z.number().int().min(0),
  costUsd: z.number().min(0),
  inCached: z.number().int().min(0),
  inUncached: z.number().int().min(0),
  out: z.number().int().min(0),
  reasoning: z.number().int().min(0),
});
export type LlmUsage = z.infer<typeof LlmUsageSchema>;
