import { z } from 'zod';
import { SpecIdSchema } from '../spec/ids.ts';
import { MetaSchema, TopicClassSchema, VideoFormatSchema } from '../spec/meta.ts';
import { EndingSchema, StoryLayerSchema } from '../spec/story.ts';

/**
 * The Director's output (P1C.5): the video's meta choices and its Story layer, plus a parts plan
 * when a big topic is split into several videos. Shaped like a VideoSpec (`meta`, `story`), so
 * spec validation paths point into the plan. Code fills the rest (`meta.id`, `meta.series`, the
 * series number) when it turns the plan into a spec (`specFromPlan`). Descriptions reach the
 * model through the output JSON Schema, so they are written to it.
 */

/**
 * Seconds as the model plans them. Deliberately without the hard limits: prompts state only the
 * configured range (the checks enforce it), and `meta.targetLengthSec` still meets the limits in
 * spec validation.
 */
const PlannedSecSchema = z.number().int().positive();

export const DirectorMetaSchema = z.strictObject({
  title: MetaSchema.shape.title.describe(
    'The video title: short, concrete, no hype; at most the characters the input\'s "title" line gives (room after the series label), or the HUD cuts it off.',
  ),
  topicClass: TopicClassSchema.describe('The topic class id from the catalogue.'),
  format: VideoFormatSchema.describe(
    '"card" for a short single-concept or real-incident video, "full" for a multi-step build.',
  ),
  targetLengthSec: PlannedSecSchema.optional().describe(
    'Planned seconds of the video. Omit when the plan has parts (each part has its own).',
  ),
});
export type DirectorMeta = z.infer<typeof DirectorMetaSchema>;

/** The ending as the model writes it; the series number is filled by code. */
const DirectorEndingSchema = EndingSchema.omit({ seriesNumber: true });

export const DirectorStorySchema = StoryLayerSchema.extend({ ending: DirectorEndingSchema });
export type DirectorStory = z.infer<typeof DirectorStorySchema>;

export const DirectorPartSchema = z.strictObject({
  part: z.number().int().min(1).describe('1 for the first part, then 2, 3, ...'),
  title: z.string().trim().min(1).max(80),
  mainIdea: z.string().trim().min(1).max(200).describe('The one idea this part explains.'),
  beatIds: z
    .array(SpecIdSchema)
    .min(1)
    .describe("This part's beats: a run of consecutive story beats, in order."),
  targetLengthSec: PlannedSecSchema.describe(
    "Planned seconds of this part; its beats' targetSec sum to it.",
  ),
});
export type DirectorPart = z.infer<typeof DirectorPartSchema>;

export const LENGTH_REASON_MAX = 160;

export const DirectorPlanSchema = z.strictObject({
  meta: DirectorMetaSchema,
  lengthReason: z
    .string()
    .trim()
    .min(1)
    .max(LENGTH_REASON_MAX)
    .optional()
    .describe('One line: why the video (or a part) runs longer than the reason threshold.'),
  story: DirectorStorySchema,
  parts: z
    .array(DirectorPartSchema)
    .min(2)
    .max(6)
    .optional()
    .describe(
      'Only for a topic split into several videos: every beat in exactly one part, parts in order.',
    ),
});
export type DirectorPlan = z.infer<typeof DirectorPlanSchema>;
