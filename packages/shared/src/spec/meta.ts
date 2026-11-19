import { z } from 'zod';
import { SHORT_LENGTH_SEC } from '../domain/run.ts';
import { SpecIdSchema } from './ids.ts';

export const TOPIC_CLASSES = ['product-design', 'internals', 'concept', 'ai-ml'] as const;
export const TopicClassSchema = z.enum(TOPIC_CLASSES);
export type TopicClass = z.infer<typeof TopicClassSchema>;

/**
 * How the video is framed: `full` (the board fills the stage between the HUD and the subtitles) or
 * `card` (a persistent title header, a 16:9 diagram window under it, then the headline and the
 * subtitles). Set per run, never by agents (left out of the LLM schema); the layout engine and
 * the HUD read it.
 */
export const VIDEO_FORMATS = ['full', 'card'] as const;
export const VideoFormatSchema = z.enum(VIDEO_FORMATS);
export type VideoFormat = z.infer<typeof VideoFormatSchema>;

export const MetaSchema = z.strictObject({
  id: SpecIdSchema,
  /** Series tag (`series.tag`). */
  series: SpecIdSchema,
  title: z.string().min(1),
  topicClass: TopicClassSchema,
  targetLengthSec: z.number().int().min(SHORT_LENGTH_SEC.min).max(SHORT_LENGTH_SEC.max),
  format: VideoFormatSchema.default('full'),
});
export type Meta = z.infer<typeof MetaSchema>;
