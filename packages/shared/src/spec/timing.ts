import { z } from 'zod';
import { SpecIdSchema } from './ids.ts';

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
  beats: z.array(BeatTimingSchema).min(1),
  events: z.array(ResolvedEventTimeSchema).default([]),
});
export type TimingLayer = z.infer<typeof TimingLayerSchema>;
