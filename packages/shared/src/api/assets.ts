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

// ---------------------------------------------------------------------------------------------
// A run's missing assets (P1C.12 A5)

export const MissingAssetDtoSchema = z.strictObject({
  id: z.string(),
  /** Each board use: the beat and the JSON path of the id. */
  uses: z.array(z.strictObject({ beatId: z.string(), path: z.string() })),
  beatIds: z.array(z.string()),
  /** The Generator's request for it (from the spec), if any. */
  request: z
    .strictObject({ description: z.string(), family: AssetFamilySchema, closest: z.string() })
    .nullable(),
  /** Its draft, if one exists: the variants that can be approved and the latest sheet. */
  draft: z
    .strictObject({
      status: AssetStatusSchema,
      state: AssetDraftStateSchema,
      approvable: z.array(z.number().int()),
      sheetPath: z.string().nullable(),
    })
    .nullable(),
  /** The approved assets that rank closest (best first). */
  suggestions: z.array(z.strictObject({ id: z.string(), score: z.number() })),
});
export type MissingAssetDto = z.infer<typeof MissingAssetDtoSchema>;

export const RunMissingAssetsResponseSchema = z.strictObject({
  runId: z.number().int(),
  /** The gate whose subject was read (the one the run waits at), else null: the latest spec. */
  gate: z.enum(['scenes', 'draft']).nullable(),
  specVersionId: z.number().int().nullable(),
  items: z.array(MissingAssetDtoSchema),
});
export type RunMissingAssetsResponse = z.infer<typeof RunMissingAssetsResponseSchema>;

export const RESOLVE_ASSET_ACTIONS = ['approve-draft', 'swap', 'skip'] as const;

/**
 * Resolving one missing asset at gate 3 or 4: approve a draft variant (no spec change: the stills
 * or the draft render again), swap every use to an approved id (a spec edit, then a scoped
 * curate), or skip (recorded; the final render stays blocked).
 */
export const ResolveMissingAssetRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('approve-draft'),
    variant: z.number().int().min(1),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(12).optional(),
    aliases: z.array(LibraryAssetIdSchema).max(ASSET_MAX_ALIASES).optional(),
  }),
  z.strictObject({ action: z.literal('swap'), to: LibraryAssetIdSchema }),
  z.strictObject({
    action: z.literal('skip'),
    note: z.string().trim().max(ASSET_NOTE_MAX).optional(),
  }),
]);
export type ResolveMissingAssetRequest = z.infer<typeof ResolveMissingAssetRequestSchema>;

export const ResolveMissingAssetResponseSchema = z.strictObject({
  action: z.enum(RESOLVE_ASSET_ACTIONS),
  run: z.strictObject({ status: z.string(), step: z.string() }),
  /** Runs sent back to re-render (approving a draft refreshes every run waiting on the id). */
  refreshed: z.array(z.number().int()),
});
export type ResolveMissingAssetResponse = z.infer<typeof ResolveMissingAssetResponseSchema>;

/** `POST /api/assets/drafts/:id/approve`: the asset, and the runs it refreshed. */
export const ApproveDraftResponseSchema = z.strictObject({
  asset: AssetDetailDtoSchema,
  refreshed: z.array(z.number().int()),
});
export type ApproveDraftResponse = z.infer<typeof ApproveDraftResponseSchema>;
