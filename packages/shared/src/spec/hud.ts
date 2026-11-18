import { z } from 'zod';

/**
 * Per-video HUD toggles (all on by default). A part that is on but has no data (no hero metric,
 * no story clock, no headline on a beat) is not drawn.
 */
export const HudSchema = z.strictObject({
  topBar: z.boolean().default(true),
  chapterHeader: z.boolean().default(true),
  stepTracker: z.boolean().default(true),
  heroMetric: z.boolean().default(true),
  storyClock: z.boolean().default(true),
  headline: z.boolean().default(true),
});
export type Hud = z.infer<typeof HudSchema>;
export type HudPart = keyof Hud;
export const HUD_PARTS = Object.keys(HudSchema.shape) as HudPart[];
