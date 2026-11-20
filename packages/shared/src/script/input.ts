import { z } from 'zod';
import { ExplanationLevelSchema } from '../config/video.ts';
import { PauseSecSchema } from '../config/settings.ts';
import { SpecIdSchema } from '../spec/ids.ts';

/**
 * What one Scriptwriter step read (`runs/<id>/script/input-<step>.json`): the Director and
 * research steps it wrote from, the pace and pauses its word budgets came from, the budgets
 * themselves and the style rules. The plan and notes stay in the steps it names.
 */

export const WordBudgetSchema = z.strictObject({
  beatId: SpecIdSchema,
  targetSec: z.number().positive(),
  narrationSec: z.number().nonnegative(),
  words: z.number().int().nonnegative(),
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
});

export const ScriptwriterInputSchema = z.strictObject({
  /** The Director step whose plan the script follows. */
  directStepId: z.number().int().positive(),
  /** The research step that plan was made from (its notes are the only facts). */
  researchStepId: z.number().int().positive(),
  explanationLevel: ExplanationLevelSchema,
  wordsPerSec: z.number().positive(),
  pauses: z.strictObject({ beatGapSec: PauseSecSchema, landingSec: PauseSecSchema }),
  budgets: z.array(WordBudgetSchema).min(1),
  /** Accepted style rules for the scriptwriter (scope `scriptwriter` or `all`). */
  styleRules: z.array(z.string()),
});
export type ScriptwriterInput = z.infer<typeof ScriptwriterInputSchema>;
