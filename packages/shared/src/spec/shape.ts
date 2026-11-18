import { z } from 'zod';
import { HudSchema } from './hud.ts';
import { MetaSchema } from './meta.ts';
import { SceneLayerSchema } from './scene.ts';
import { ScriptLayerSchema } from './script.ts';
import { StoryLayerSchema } from './story.ts';
import { TimingLayerSchema } from './timing.ts';

/** Bump only once real videos exist; until then the schema changes in place. */
export const VIDEO_SPEC_SCHEMA_VERSION = 1;

/**
 * Structure of a VideoSpec without cross-reference checks (see `VideoSpecSchema`). Layers after
 * `story` are optional because the pipeline fills them stage by stage.
 */
export const VideoSpecShapeSchema = z.strictObject({
  schemaVersion: z.literal(VIDEO_SPEC_SCHEMA_VERSION),
  meta: MetaSchema,
  story: StoryLayerSchema,
  /** Presentation toggles, set by the user (not the LLM). Omitted means every part is on. */
  hud: HudSchema.prefault({}),
  script: ScriptLayerSchema.optional(),
  scenes: SceneLayerSchema.optional(),
  timing: TimingLayerSchema.optional(),
});
export type VideoSpec = z.infer<typeof VideoSpecShapeSchema>;
export type VideoSpecInput = z.input<typeof VideoSpecShapeSchema>;

/** A spec the renderer can draw: script and scenes present (timing may be estimated). */
export const RenderableVideoSpecShapeSchema = VideoSpecShapeSchema.extend({
  script: ScriptLayerSchema,
  scenes: SceneLayerSchema,
});
export type RenderableVideoSpec = z.infer<typeof RenderableVideoSpecShapeSchema>;
