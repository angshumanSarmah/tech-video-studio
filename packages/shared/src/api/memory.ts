import { z } from 'zod';
import { UsageKindSchema } from '../domain/library.ts';

/** Videos `GET /api/memory/usage` covers when the query names none, and at most. */
export const DEFAULT_USAGE_VIDEOS = 10;
export const MAX_USAGE_VIDEOS = 50;

/** `GET /api/memory/usage?videos=N`: the last N exported videos. */
export const UsageQuerySchema = z.object({
  videos: z.coerce.number().int().min(1).max(MAX_USAGE_VIDEOS).default(DEFAULT_USAGE_VIDEOS),
});

/** One exported video: a single run, or a multi-part video's parts together. */
export const UsageVideoSchema = z.strictObject({
  /** The video's run: the parent of a multi-part video, else the run itself. */
  videoRunId: z.number().int().positive(),
  /** The runs that exported it (each part), in export order. */
  runIds: z.array(z.number().int().positive()),
  /** The newest export's title. */
  title: z.string().nullable(),
  /** When its newest part exported (ISO). */
  exportedAt: z.iso.datetime(),
  hooks: z.array(z.string()),
  endings: z.array(z.string()),
  sequences: z.array(z.string()),
});
export type UsageVideo = z.infer<typeof UsageVideoSchema>;

/** A value and how many of the videos used it. */
export const UsageCountSchema = z.strictObject({
  value: z.string(),
  videos: z.number().int().positive(),
});
export type UsageCount = z.infer<typeof UsageCountSchema>;

/** The usage history over the last videos (P1C.10; the Memory page's charts, P1D.8). */
export const UsageSummarySchema = z.strictObject({
  /** Newest first. */
  videos: z.array(UsageVideoSchema),
  /** Per kind, each value with the number of videos that used it: most used first, then by value. */
  counts: z.record(UsageKindSchema, z.array(UsageCountSchema)),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
