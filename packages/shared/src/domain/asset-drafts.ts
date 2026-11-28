import { z } from 'zod';

/**
 * Asset drafts (P1C.12 A4): an asset row with status `draft` holds the drafter's variants and the
 * reviewer's notes until one variant is approved into the library (or the row is rejected).
 * Nothing is approved automatically. Stored as JSON on the `assets` row (`variants`, `notes`).
 */

/** Variants the Asset drafter draws per round. */
export const ASSET_DRAFT_VARIANTS = 3;
/** Longest concept line a variant carries. */
export const ASSET_CONCEPT_MAX = 120;
/** Longest reviewer note (reject, regenerate, approve). */
export const ASSET_NOTE_MAX = 500;
/** Most new drafts one video queues by itself (auto-drafting on request). */
export const MAX_AUTO_DRAFTS_PER_VIDEO = 3;

const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\n\r]*$/, 'One line, without line breaks.');

/**
 * One variant the drafter drew. `number` counts across rounds (round 1: 1-3, round 2: 4-6), so a
 * reviewer approves "variant 5". A variant the sanitizer refused keeps its `problems` and has no
 * file; only one with an `svgPath` (house SVG under `assets/drafts/<id>/`) can be approved.
 */
export const AssetDraftVariantSchema = z.strictObject({
  number: z.number().int().min(1),
  round: z.number().int().min(1),
  concept: z.string().trim().min(1).max(ASSET_CONCEPT_MAX),
  svgPath: z.string().min(1).nullable(),
  problems: z.array(z.string()),
  /** The model that drew it (the `asset` role's model then) and its prompt (`asset@v1`). */
  model: z.string().min(1),
  prompt: z.string().min(1),
  /** The round's `llm_calls` ids (every attempt), for its cost. */
  callIds: z.array(z.number().int().positive()),
});
export type AssetDraftVariant = z.infer<typeof AssetDraftVariantSchema>;

export const ASSET_NOTE_KINDS = ['reject', 'regenerate', 'approve'] as const;
export const AssetNoteKindSchema = z.enum(ASSET_NOTE_KINDS);
export type AssetNoteKind = z.infer<typeof AssetNoteKindSchema>;

/** A reviewer decision on a draft, with its note (a regenerate's note is the drafter's feedback). */
export const AssetNoteSchema = z.strictObject({
  at: z.iso.datetime(),
  kind: AssetNoteKindSchema,
  /** The round the note was written on (a regenerate's note feeds the next one). */
  round: z.number().int().min(0),
  text: z.string().trim().max(ASSET_NOTE_MAX),
});
export type AssetNote = z.infer<typeof AssetNoteSchema>;

export const AssetNoteTextSchema = z.string().trim().min(1).max(ASSET_NOTE_MAX);

/**
 * What a draft row shows, derived (never stored): `queued` (no variants yet, its job waiting),
 * `drafting` (its job running), `ready` (the latest round has a variant to approve), `failed`
 * (the latest round left none: `error` says why), and the library statuses.
 */
export const ASSET_DRAFT_STATES = [
  'queued',
  'drafting',
  'ready',
  'failed',
  'approved',
  'rejected',
] as const;
export const AssetDraftStateSchema = z.enum(ASSET_DRAFT_STATES);
export type AssetDraftState = z.infer<typeof AssetDraftStateSchema>;

// ---------------------------------------------------------------------------------------------
// The Asset drafter's answer (asset@v1)

export const AssetDraftAnswerVariantSchema = z.strictObject({
  concept: oneLine(ASSET_CONCEPT_MAX).describe(
    'One line: which object or metaphor stands for the thing.',
  ),
  svg: z
    .string()
    .min(1)
    .describe('The whole house SVG, exactly the root in HOUSE STYLE with flat shapes inside.'),
});

export const AssetDraftOutputSchema = z.strictObject({
  variants: z
    .array(AssetDraftAnswerVariantSchema)
    .length(ASSET_DRAFT_VARIANTS)
    .describe('Exactly three variants that differ in idea.'),
});
export type AssetDraftOutput = z.infer<typeof AssetDraftOutputSchema>;
