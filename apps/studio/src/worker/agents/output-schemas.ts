import {
  AnalystOutputSchema,
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
 * without an entry has no output section yet (its step comes in a later task). The Curator has
 * none on purpose: its two passes give their output shapes in the user message, so both calls
 * share one cached system prompt.
 */
export const ROLE_OUTPUT_SCHEMAS: Readonly<Partial<Record<PromptRole, z.ZodType>>> = {
  researcher: ResearchNotesSchema,
  director: DirectorPlanSchema,
  scriptwriter: ScriptwriterOutputSchema,
  generator: GeneratorOutputSchema,
  analyst: AnalystOutputSchema,
};
