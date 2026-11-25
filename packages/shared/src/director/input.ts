import { z } from 'zod';
import { ExplanationLevelSchema, VideoLengthSecSchema } from '../config/video.ts';
import { RecentStructureSchema } from '../memory/fingerprint.ts';
import { TopicMatchSchema } from '../memory/topic-similarity.ts';
import { VideoFormatSchema } from '../spec/meta.ts';

/**
 * What one Director step read (`runs/<id>/direct/input-<step>.json`): everything its prompt was
 * built from except the research notes themselves, which stay in the research step it names.
 */

export const DirectorMemorySchema = z.strictObject({
  /** Accepted style rules for the director (scope `director` or `all`). */
  styleRules: z.array(z.string()),
  /** Usage in the last `videos` exported videos, to avoid. */
  recent: z.strictObject({
    videos: z.number().int().min(0),
    devices: z.array(z.string()),
    layouts: z.array(z.string()),
    patterns: z.array(z.string()),
    /** `<device>/<layout>` combos (`deviceLayoutCombo`). */
    combos: z.array(z.string()),
    /**
     * Each recent video's hooks and main pattern sequences, newest first (P1C.10). Absent in
     * steps from before usage history.
     */
    structures: z.array(RecentStructureSchema).optional(),
  }),
  /** Topics of earlier exported videos, newest first: not to repeat. */
  pastTopics: z.array(z.strictObject({ title: z.string(), notes: z.string().nullable() })),
  /**
   * Earlier topics close to this run's (exported or in progress), closest first: the beat
   * sheet's `topic_similar` warnings. Absent in steps from before topic history.
   */
  similarTopics: z.array(TopicMatchSchema).optional(),
});
export type DirectorMemory = z.infer<typeof DirectorMemorySchema>;

export const DirectorInputSchema = z.strictObject({
  topic: z.strictObject({ title: z.string(), notes: z.string().nullable() }),
  series: z.strictObject({
    tag: z.string(),
    name: z.string(),
    label: z.string(),
    /** The number this video gets in its series (exported videos so far + 1). */
    nextNumber: z.number().int().positive(),
  }),
  length: z.strictObject({
    /** The run's fixed length; absent means the Director decides within the range. */
    overrideSec: VideoLengthSecSchema.optional(),
    minSec: VideoLengthSecSchema,
    maxSec: VideoLengthSecSchema,
    reasonAboveSec: VideoLengthSecSchema,
  }),
  parts: z.strictObject({ allowed: z.boolean(), max: z.number().int().min(2) }),
  explanationLevel: ExplanationLevelSchema,
  /** The run's `settings.format`, which wins over the plan's recommendation. */
  formatOverride: VideoFormatSchema.optional(),
  /** The research step whose notes the Director read. */
  researchStepId: z.number().int().positive(),
  memory: DirectorMemorySchema,
  /** The catalogue block's `CATALOGUE VERSIONS` line. */
  catalogueVersions: z.string(),
  /**
   * About how many title characters the HUD shows after this series' label (`titleRoomChars`),
   * the prompt's title hint. Absent in steps from before the hint was per series.
   */
  titleMaxChars: z.number().int().positive().optional(),
  /** A reviewer's note from a gate's regenerate (the user message's FEEDBACK section). */
  feedback: z.string().min(1).optional(),
});
export type DirectorInput = z.infer<typeof DirectorInputSchema>;
