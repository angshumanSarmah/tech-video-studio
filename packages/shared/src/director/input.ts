import { z } from 'zod';
import { ExplanationLevelSchema, VideoLengthSecSchema } from '../config/video.ts';
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
  }),
  /** Topics of earlier exported videos, newest first: not to repeat. */
  pastTopics: z.array(z.strictObject({ title: z.string(), notes: z.string().nullable() })),
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
});
export type DirectorInput = z.infer<typeof DirectorInputSchema>;
