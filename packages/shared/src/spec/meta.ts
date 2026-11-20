import { z } from 'zod';
import { VideoLengthSecSchema } from '../config/video.ts';
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

/**
 * About how many characters of a video title the HUD shows without cutting it, in the default
 * theme: the narrowest place it appears, the title block's subject line after the longest seeded
 * series label ("SYSTEM DESIGN · "); the card header's two display lines hold more. A renderer
 * test recomputes it (`roomInChars`). A hint for prompts: `hudTextWarnings` measures the real
 * text with the run's series label.
 */
export const TITLE_MAX_CHARS = 44;

export const MetaSchema = z.strictObject({
  id: SpecIdSchema,
  /** Series tag (`series.tag`). */
  series: SpecIdSchema,
  title: z.string().min(1),
  topicClass: TopicClassSchema,
  targetLengthSec: VideoLengthSecSchema,
  format: VideoFormatSchema.default('full'),
});
export type Meta = z.infer<typeof MetaSchema>;
