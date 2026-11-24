import {
  CuratorReviewSchema,
  DirectorPlanSchema,
  GeneratorOutputSchema,
  ResearchNotesSchema,
  ScriptwriterOutputSchema,
} from '@explainer-studio/shared';
import type { z } from 'zod';
import type { PromptRole } from './prompts/templates.ts';

/**
 * The schema each role's answer is validated with. `buildPrompt` renders it as JSON Schema
 * after the role prompt, and the role's step passes the same schema to `callJson`. A role
 * without an entry has no output section yet (its step comes in a later task).
 */
export const ROLE_OUTPUT_SCHEMAS: Readonly<Partial<Record<PromptRole, z.ZodType>>> = {
  researcher: ResearchNotesSchema,
  director: DirectorPlanSchema,
  scriptwriter: ScriptwriterOutputSchema,
  generator: GeneratorOutputSchema,
  curator: CuratorReviewSchema,
};
