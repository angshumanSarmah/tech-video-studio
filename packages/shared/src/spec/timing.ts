import { z } from 'zod';
import { SpecIdSchema } from './ids.ts';
import { TimingSettingsSchema } from '../config/settings.ts';

/**
 * Timing layer, filled by code (TTS + timing assembly), never by the LLM. All times are seconds
 * on the global narration track; the renderer converts to frames at its preset's fps.
 */

const SecSchema = z.number().min(0);

export const TimedWordSchema = z
  .strictObject({ text: z.string().min(1), startSec: SecSchema, endSec: SecSchema })
  .refine((w) => w.endSec >= w.startSec, { message: 'endSec must be >= startSec.' });
export type TimedWord = z.infer<typeof TimedWordSchema>;

export const BeatTimingSchema = z
  .strictObject({
    beatId: SpecIdSchema,
    startSec: SecSchema,
    endSec: SecSchema,
    /** One entry per `narrationWords(narration)` word, in order. */
    words: z.array(TimedWordSchema),
  })
  .refine((b) => b.endSec > b.startSec, { message: 'endSec must be > startSec.' });
export type BeatTiming = z.infer<typeof BeatTimingSchema>;

/**
 * Derived cache of resolved event times. The renderer may recompute them from word timings and
 * must not trust them after a script or scene edit.
 */
export const ResolvedEventTimeSchema = z.strictObject({
  beatId: SpecIdSchema,
  eventIndex: z.number().int().min(0),
  atSec: SecSchema,
});
export type ResolvedEventTime = z.infer<typeof ResolvedEventTimeSchema>;

export const TimingLayerSchema = z.strictObject({
  /** Narration WAV (one track, 0 s = the first frame), relative to the data dir. */
  audioFile: z.string().min(1),
  /**
   * Beats in story order. A beat's `endSec` is the end of its narration; any silence before the
   * next beat's `startSec` (gap, landing hold) keeps the beat's scene on screen.
   */
  beats: z.array(BeatTimingSchema).min(1),
  events: z.array(ResolvedEventTimeSchema).default([]),
  /**
   * End of the narration track and the video (tail and any final landing hold included).
   * Without it the video ends `END_TAIL_SEC` after the last beat.
   */
  endSec: SecSchema.optional(),
  /** The pauses the timing step applied (`TimingSettingsSchema` values), for the record. */
  pauses: TimingSettingsSchema.optional(),
});
export type TimingLayer = z.infer<typeof TimingLayerSchema>;
