import { z } from 'zod';
import { SpecIdSchema } from './ids.ts';

/** Story layer, written by the Director. Device, layout, pattern and world ids are catalogue ids. */

/** The story clock's value (story-time seconds) at the start of a beat. */
export const StoryClockKeyframeSchema = z.strictObject({
  beatId: SpecIdSchema,
  value: z.number().min(0),
});
export type StoryClockKeyframe = z.infer<typeof StoryClockKeyframeSchema>;

/**
 * A running clock in story time, e.g. "ORDER → DOORBELL · 1:52". Values are seconds of story time,
 * shown as m:ss. It runs from `startValue` at the first beat's start to `endValue` at the last
 * beat's end, linearly through any keyframes in between.
 */
export const StoryClockSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  startValue: z.number().min(0),
  endValue: z.number().min(0),
  /** Optional pacing: in story order, never on the first beat (that is `startValue`). */
  keyframes: z.array(StoryClockKeyframeSchema).default([]),
});
export type StoryClock = z.infer<typeof StoryClockSchema>;

/** A pinned pill such as "iPhone 17 · 3.5 min", with an optional story clock. */
export const HeroMetricSchema = z.strictObject({
  label: z.string().min(1),
  /** Display value, kept as text so units and formatting survive. */
  value: z.string().min(1),
  storyClock: StoryClockSchema.optional(),
});
export type HeroMetric = z.infer<typeof HeroMetricSchema>;

export const ChapterSchema = z.strictObject({
  id: SpecIdSchema,
  title: z.string().min(1),
  /** Question form of the title, for question-driven chapters. */
  question: z.string().min(1).optional(),
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const StoryBeatSchema = z.strictObject({
  id: SpecIdSchema,
  chapterId: SpecIdSchema,
  intent: z.string().min(1),
  device: SpecIdSchema.optional(),
  targetSec: z.number().positive(),
  /** Research fact ids this beat relies on (resolved against research notes in P1C.5). */
  factIds: z.array(SpecIdSchema).default([]),
  /** Suggestion for the Generator, which makes the final choice in the scene layer. */
  layoutMode: SpecIdSchema.optional(),
  /** Suggestions for the Generator, which makes the final choice in the scene layer. */
  suggestedPatternIds: z.array(SpecIdSchema).default([]),
});
export type StoryBeat = z.infer<typeof StoryBeatSchema>;

export const PlantedQuestionSchema = z.strictObject({
  text: z.string().min(1),
  /** Beat that plants the question. */
  beatId: SpecIdSchema,
  /** Beat that answers it; must come after `beatId`. */
  payoffBeatId: SpecIdSchema,
});
export type PlantedQuestion = z.infer<typeof PlantedQuestionSchema>;

export const RejectedAlternativeSchema = z.strictObject({
  /** Beat that shows the rejected alternative. */
  beatId: SpecIdSchema,
  summary: z.string().min(1),
});
export type RejectedAlternative = z.infer<typeof RejectedAlternativeSchema>;

export const EndingSchema = z.strictObject({
  kind: SpecIdSchema,
  cta: z.string().min(1).optional(),
});
export type Ending = z.infer<typeof EndingSchema>;

export const MissingPrimitiveRequestSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  /** Primitive or pattern id used instead. */
  fallbackUsed: SpecIdSchema,
});
export type MissingPrimitiveRequest = z.infer<typeof MissingPrimitiveRequestSchema>;

export const StoryLayerSchema = z.strictObject({
  devices: z.array(SpecIdSchema).default([]),
  metaphorWorld: SpecIdSchema.optional(),
  heroMetric: HeroMetricSchema.optional(),
  chapters: z.array(ChapterSchema).min(1),
  beats: z.array(StoryBeatSchema).min(1),
  plantedQuestion: PlantedQuestionSchema.optional(),
  rejectedAlternative: RejectedAlternativeSchema.optional(),
  ending: EndingSchema,
  missingPrimitiveRequests: z.array(MissingPrimitiveRequestSchema).default([]),
});
export type StoryLayer = z.infer<typeof StoryLayerSchema>;
