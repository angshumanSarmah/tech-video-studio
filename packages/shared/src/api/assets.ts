import { z } from 'zod';
import {
  ASSET_NOTE_MAX,
  AssetDraftStateSchema,
  AssetDraftVariantSchema,
  AssetNoteSchema,
  AssetNoteTextSchema,
} from '../domain/asset-drafts.ts';
import {
  ASSET_DESCRIPTION_MAX,
  ASSET_MAX_ALIASES,
  AssetFamilySchema,
  LibraryAssetIdSchema,
} from '../domain/assets.ts';
import { AssetStatusSchema } from '../domain/library.ts';

/**
 * Adding an asset by hand (P1C.12; `studio assets add`, later `POST /api/assets`): the SVG text
 * (sanitized, then stored as a house SVG) and its library metadata. An upload is approved: the
 * person adding it is the reviewer. Licence and source default to the project's own drawing.
 */
export const UploadAssetRequestSchema = z.strictObject({
  svg: z.string().min(1),
  id: LibraryAssetIdSchema,
  name: z.string().trim().min(1).max(40),
  family: AssetFamilySchema,
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(12).default([]),
  aliases: z.array(LibraryAssetIdSchema).max(ASSET_MAX_ALIASES).default([]),
  description: z
    .string()
    .trim()
    .min(1)
    .max(ASSET_DESCRIPTION_MAX)
    .regex(/^[^\n\r]*$/, 'One line, without line breaks.')
    .optional(),
  /** SPDX expression; a third-party icon set's when the file comes from one. */
  licence: z.string().trim().min(1).default('LicenseRef-own'),
  /** Where it came from, e.g. `tabler@<version>:<icon>`; `uploaded` by default. */
  source: z.string().trim().min(1).default('uploaded'),
});
export type UploadAssetRequest = z.input<typeof UploadAssetRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Drafts (P1C.12 A4)

const descriptionLine = z
  .string()
  .trim()
  .min(1)
  .max(ASSET_DESCRIPTION_MAX)
  .regex(/^[^\n\r]*$/, 'One line, without line breaks.');

/**
 * Asking for a new asset by hand (`POST /api/assets/drafts`, `studio assets draft`): the id
 * defaults to a slug of the name. Queues the Asset drafter.
 */
export const CreateDraftRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  family: AssetFamilySchema,
  description: descriptionLine,
  id: LibraryAssetIdSchema.optional(),
});
export type CreateDraftRequest = z.input<typeof CreateDraftRequestSchema>;

/** Approving one variant into the library; the rest of the row's metadata may change with it. */
export const ApproveDraftRequestSchema = z.strictObject({
  variant: z.number().int().min(1),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(12).optional(),
  aliases: z.array(LibraryAssetIdSchema).max(ASSET_MAX_ALIASES).optional(),
  name: z.string().trim().min(1).max(40).optional(),
  family: AssetFamilySchema.optional(),
  note: z.string().trim().max(ASSET_NOTE_MAX).optional(),
});
export type ApproveDraftRequest = z.input<typeof ApproveDraftRequestSchema>;

/** A reject's or a regenerate's note (a regenerate's is the drafter's feedback). */
export const DraftNoteRequestSchema = z.strictObject({ note: AssetNoteTextSchema });
export type DraftNoteRequest = z.infer<typeof DraftNoteRequestSchema>;

export const AssetListQuerySchema = z.strictObject({
  status: AssetStatusSchema.optional(),
  family: AssetFamilySchema.optional(),
  /** Words matched against id, name, tags and aliases. */
  q: z.string().trim().min(1).max(80).optional(),
});

export const AssetSummaryDtoSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  family: AssetFamilySchema,
  status: AssetStatusSchema,
  state: AssetDraftStateSchema,
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  description: z.string().nullable(),
  licence: z.string(),
  source: z.string(),
  /** Data-dir relative; null for a draft not approved. */
  svgPath: z.string().nullable(),
});
export type AssetSummaryDto = z.infer<typeof AssetSummaryDtoSchema>;

export const AssetListResponseSchema = z.strictObject({ items: z.array(AssetSummaryDtoSchema) });
export type AssetListResponse = z.infer<typeof AssetListResponseSchema>;

export const AssetRequestDtoSchema = z.strictObject({
  runId: z.number().int().nullable(),
  beatIds: z.array(z.string()),
  description: z.string(),
  closest: z.string(),
});

export const AssetDetailDtoSchema = AssetSummaryDtoSchema.extend({
  variants: z.array(AssetDraftVariantSchema),
  notes: z.array(AssetNoteSchema),
  error: z.string().nullable(),
  approvedVariant: z.number().int().nullable(),
  /** The latest round's preview sheet (data-dir relative), once rendered. */
  sheetPath: z.string().nullable(),
  requests: z.array(AssetRequestDtoSchema),
  /** What drafting it cost, every round. */
  costUsd: z.number(),
  /** The queued or running `draft_asset` job, if any. */
  jobId: z.number().int().nullable(),
});
export type AssetDetailDto = z.infer<typeof AssetDetailDtoSchema>;

/** `POST /api/assets/drafts` and `…/regenerate` (202): the draft and the job drawing it. */
export const DraftJobResponseSchema = z.strictObject({
  id: z.string(),
  jobId: z.number().int(),
});
export type DraftJobResponse = z.infer<typeof DraftJobResponseSchema>;
