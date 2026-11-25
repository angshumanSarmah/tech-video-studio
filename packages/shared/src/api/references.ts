import { z } from 'zod';
import {
  BacklogStatusSchema,
  ReferenceOriginSchema,
  ReferenceStatusSchema,
} from '../domain/library.ts';
import { DeviceIdSchema } from '../catalogues/devices.ts';
import { TopicClassSchema } from '../spec/meta.ts';
import { AvoidNameSchema, ReferenceRecordSchema } from '../reference/record.ts';
import { listOf } from './common.ts';

/** The longest breakdown a person may paste (about four pages). */
export const MAX_BREAKDOWN_CHARS = 20_000;

/** Screenshots kept with a reference: stored for the person, never sent to a model. */
export const ATTACHMENT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export const ReferenceAttachmentSchema = z.strictObject({
  /** Relative to the data dir. */
  path: z.string(),
  name: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type ReferenceAttachment = z.infer<typeof ReferenceAttachmentSchema>;

/** One missing-primitive request (backlog row), as a reference or run shows it. */
export const BacklogRequestDtoSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  status: BacklogStatusSchema,
  runId: z.number().int().nullable(),
  referenceVideoId: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
});
export type BacklogRequestDto = z.infer<typeof BacklogRequestDtoSchema>;

/** A reference in a list. */
export const ReferenceSummaryDtoSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string(),
  title: z.string(),
  origin: ReferenceOriginSchema,
  status: ReferenceStatusSchema,
  topicClass: TopicClassSchema.nullable(),
  devices: z.array(DeviceIdSchema),
  /** Why the last analysis failed. */
  error: z.string().nullable(),
  attachments: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ReferenceSummaryDto = z.infer<typeof ReferenceSummaryDtoSchema>;

export const ReferenceListResponseSchema = listOf(ReferenceSummaryDtoSchema);
export type ReferenceListResponse = z.infer<typeof ReferenceListResponseSchema>;

/** `GET /api/references/:id`: the record, the breakdown it came from and its backlog rows. */
export const ReferenceDetailDtoSchema = ReferenceSummaryDtoSchema.extend({
  breakdown: z.string(),
  record: ReferenceRecordSchema.nullable(),
  attachmentFiles: z.array(ReferenceAttachmentSchema),
  backlog: z.array(BacklogRequestDtoSchema),
});
export type ReferenceDetailDto = z.infer<typeof ReferenceDetailDtoSchema>;

/**
 * `POST /api/references` as JSON (multipart form data carries the same fields, `namesToAvoid`
 * as JSON text, plus `attachments` files).
 */
export const CreateReferenceRequestSchema = z.strictObject({
  breakdown: z.string().trim().min(1).max(MAX_BREAKDOWN_CHARS),
  /** A working title for the list until the analyst names it. */
  title: z.string().trim().min(1).max(80).optional(),
  namesToAvoid: z.array(AvoidNameSchema).max(15).optional(),
});
export type CreateReferenceRequest = z.infer<typeof CreateReferenceRequestSchema>;

/** 202: the reference and the analyst's job. */
export const CreateReferenceResponseSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string(),
  jobId: z.number().int().positive(),
});
export type CreateReferenceResponse = z.infer<typeof CreateReferenceResponseSchema>;

/** `PUT /api/references/:id`: the whole record, checked like the analyst's answer. */
export const UpdateReferenceRequestSchema = z.strictObject({ record: z.unknown() });

/** `POST /api/references/:id/reanalyze`: 202 with the analyst's job. */
export const ReanalyzeReferenceResponseSchema = z.object({
  jobId: z.number().int().positive(),
});
export type ReanalyzeReferenceResponse = z.infer<typeof ReanalyzeReferenceResponseSchema>;
