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

/**
 * A part of a multi-part video (P1C.9): part `index` of `count`, each its own video. Set by code
 * from the run (`runs.part_index`, `part_count`), never by agents (left out of the LLM schema).
 * The title block shows it ("PART 2/3") and the checks read it: earlier parts end on a
 * cliffhanger, parts 2+ open with a recap, only the last closes the topic.
 */
export const PartRefSchema = z
  .strictObject({
    index: z.number().int().min(1),
    count: z.number().int().min(2),
  })
  .refine((p) => p.index <= p.count, { message: 'A part index is at most the part count.' });
export type PartRef = z.infer<typeof PartRefSchema>;

export const MetaSchema = z.strictObject({
  id: SpecIdSchema,
  /** Series tag (`series.tag`). */
  series: SpecIdSchema,
  title: z.string().min(1),
  topicClass: TopicClassSchema,
  targetLengthSec: VideoLengthSecSchema,
  format: VideoFormatSchema.default('full'),
  part: PartRefSchema.optional(),
});
export type Meta = z.infer<typeof MetaSchema>;
