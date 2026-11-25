import { z } from 'zod';
import { MetaSchema } from './meta.ts';
import { BeatSceneSchema, SceneLayerSchema } from './scene.ts';
import { ScriptLayerSchema } from './script.ts';
import { StoryLayerSchema } from './story.ts';

/**
 * LLM-written parts of a VideoSpec. Timing is filled by code and has no LLM schema.
 * `scene` is one beat (per-beat generation); `scenes` is the whole layer.
 */
const LLM_SCHEMAS = {
  // The format and the part are run data, not the model's choice.
  meta: MetaSchema.omit({ format: true, part: true }),
  story: StoryLayerSchema,
  script: ScriptLayerSchema,
  scene: BeatSceneSchema,
  scenes: SceneLayerSchema,
} as const;

export type LlmSpecPart = keyof typeof LLM_SCHEMAS;
export const LLM_SPEC_PARTS = Object.keys(LLM_SCHEMAS) as LlmSpecPart[];

/**
 * JSON Schema (draft 2020-12) for prompts and external prompt packs. Uses the input shape, so
 * fields with defaults are optional. Cross-reference checks are not expressible here; imported
 * output is still validated with `validateVideoSpec`.
 */
export function llmJsonSchema(part: LlmSpecPart): Record<string, unknown> {
  return z.toJSONSchema(LLM_SCHEMAS[part], { io: 'input' });
}
