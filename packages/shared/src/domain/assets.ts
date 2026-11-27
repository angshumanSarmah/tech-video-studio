import { z } from 'zod';
import { SpecIdSchema } from '../spec/ids.ts';

/**
 * The asset library: line-drawn SVG glyphs in the house style (`docs/asset-style.md`), stored
 * under `<DATA_DIR>/assets/<id>.svg` with a row in the `assets` table. Primitives reference them
 * by id. Logos are not library assets: they fill per-video logo slots (`spec.logos`) with a file
 * the user supplies.
 */

/** What an asset depicts. Closed: the Generator filters by family and drafts name one. */
export const ASSET_FAMILIES = [
  'infra',
  'network',
  'data',
  'security',
  'people',
  'ai',
  'time',
  'object',
  'transport',
  'ui',
  'symbol',
  'dev',
] as const;
export const AssetFamilySchema = z.enum(ASSET_FAMILIES);
export type AssetFamily = z.infer<typeof AssetFamilySchema>;

/** Ids starting with this prefix name logo slots; library ids never use it. */
export const LOGO_ID_PREFIX = 'logo_';

/** A library asset id: a slug that is not a logo slot id. */
export const LibraryAssetIdSchema = SpecIdSchema.refine(
  (id) => !id.startsWith(LOGO_ID_PREFIX),
  `Library asset ids must not start with "${LOGO_ID_PREFIX}" (reserved for logo slots).`,
);

/** Most aliases one asset may declare. */
export const ASSET_MAX_ALIASES = 8;
/** Longest asset description (what the glyph shows, one line). */
export const ASSET_DESCRIPTION_MAX = 200;

/** Library metadata, as stored in the `assets` table. */
export const AssetMetaSchema = z.strictObject({
  id: LibraryAssetIdSchema,
  name: z.string().trim().min(1).max(40),
  family: AssetFamilySchema,
  tags: z.array(z.string().trim().min(1).max(32)).max(12),
  /**
   * Other ids that name the same glyph (`gpu_card` -> `gpu`). Only the Generator's near-identical
   * substitution reads them; a render resolves ids exactly. Unique across the library.
   */
  aliases: z.array(LibraryAssetIdSchema).max(ASSET_MAX_ALIASES).optional(),
  /** What the glyph shows, in one line (drafts and uploads; imported icons have none). */
  description: z
    .string()
    .trim()
    .min(1)
    .max(ASSET_DESCRIPTION_MAX)
    .regex(/^[^\n\r]*$/, 'One line, without line breaks.')
    .optional(),
  /** House style version the SVG was drawn to; bumped when the style rules change. */
  styleVersion: z.number().int().min(1),
  /** SPDX expression, e.g. `ISC` or `ISC AND MIT`. */
  licence: z.string().min(1),
  /** Where it came from, e.g. `lucide@<version>:<icon>`, `drafted`, `uploaded`. */
  source: z.string().min(1),
});
export type AssetMeta = z.infer<typeof AssetMetaSchema>;

// ---------------------------------------------------------------------------------------------
// Asset requests (P1C.12): an asset the Generator wanted and the library lacks

/** Most asset requests one board may carry, and one video (or part) in all. */
export const MAX_ASSET_REQUESTS_PER_BEAT = 1;
export const MAX_ASSET_REQUESTS_PER_VIDEO = 3;

/**
 * A new asset a board uses before it exists: the id is drawn as a placeholder until a drawing of
 * it is approved (approving fixes the render with no spec change). `closest` is the approved id
 * the board would use instead (an auto run swaps to it).
 */
export const MissingAssetRequestSchema = z.strictObject({
  assetId: LibraryAssetIdSchema.describe(
    'The new id this board uses: a lowercase slug of what the thing is.',
  ),
  description: z
    .string()
    .trim()
    .min(1)
    .max(ASSET_DESCRIPTION_MAX)
    .regex(/^[^\n\r]*$/, 'One line, without line breaks.')
    .describe('One line: what the glyph shows.'),
  family: AssetFamilySchema,
  closest: LibraryAssetIdSchema.describe(
    'The id from ASSETS you would use instead: an approved asset.',
  ),
});
export type MissingAssetRequest = z.infer<typeof MissingAssetRequestSchema>;

// ---------------------------------------------------------------------------------------------
// House SVG shapes: what the renderer draws. Never raw markup.

export const ASSET_SHAPE_TAGS = [
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
] as const;
export type AssetShapeTag = (typeof ASSET_SHAPE_TAGS)[number];

/** Geometry attributes allowed on a shape (any shape; the browser ignores irrelevant ones). */
export const ASSET_GEOMETRY_ATTRS = [
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'width',
  'height',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
] as const;

/**
 * Palette tokens: the only colours an asset may use. `currentColor` is the primitive's semantic
 * colour; `var(--asset-fill)` its soft fill (resolved by the renderer, never left to CSS).
 */
export const ASSET_FILL_TOKENS = ['none', 'currentColor', 'var(--asset-fill)'] as const;
export const ASSET_STROKE_TOKENS = ['none', 'currentColor'] as const;

const geometryShape = Object.fromEntries(
  ASSET_GEOMETRY_ATTRS.map((attr) => [attr, z.string().min(1).max(4000).optional()]),
) as Record<(typeof ASSET_GEOMETRY_ATTRS)[number], z.ZodOptional<z.ZodString>>;

export const AssetShapeSchema = z.strictObject({
  tag: z.enum(ASSET_SHAPE_TAGS),
  attrs: z.strictObject({
    ...geometryShape,
    fill: z.enum(ASSET_FILL_TOKENS).optional(),
    stroke: z.enum(ASSET_STROKE_TOKENS).optional(),
  }),
});
export type AssetShape = z.infer<typeof AssetShapeSchema>;

/** Most shapes one asset may have (keeps drafts simple and renders cheap). */
export const ASSET_MAX_SHAPES = 48;

export const LibraryAssetSchema = AssetMetaSchema.extend({
  kind: z.literal('library'),
  shapes: z.array(AssetShapeSchema).min(1).max(ASSET_MAX_SHAPES),
});
export type LibraryAsset = z.infer<typeof LibraryAssetSchema>;

// ---------------------------------------------------------------------------------------------
// Logo slots

/** `logo_<slug>`: a per-video slot the user fills with their own file. */
export const LogoSlotIdSchema = SpecIdSchema.regex(
  /^logo_[a-z0-9][a-z0-9_-]*$/,
  `Logo slot ids start with "${LOGO_ID_PREFIX}".`,
);

/** A logo slot declared by a video. Run setting: never written by the LLM. */
export const LogoSlotSchema = z.strictObject({
  id: LogoSlotIdSchema,
  /** Shown by the placeholder until the slot is filled, e.g. the company name. */
  label: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[^\n\r]*$/, 'One line, without line breaks.'),
});
export type LogoSlot = z.infer<typeof LogoSlotSchema>;

export const LOGO_MIME_TYPES = ['image/svg+xml', 'image/png'] as const;
export const LogoMimeSchema = z.enum(LOGO_MIME_TYPES);
export type LogoMime = z.infer<typeof LogoMimeSchema>;

/** Limits for a logo file, checked on load (and by the upload, P1D.6). */
export const LOGO_MAX_BYTES = 300 * 1024;
export const LOGO_MAX_SIDE_PX = 1024;

/** A filled logo slot, passed to the renderer as a data URI (never fetched). */
export const LogoFileSchema = z.strictObject({
  kind: z.literal('logo'),
  id: LogoSlotIdSchema,
  mime: LogoMimeSchema,
  dataUri: z
    .string()
    .regex(/^data:image\/(svg\+xml|png);base64,[A-Za-z0-9+/]+=*$/, 'A base64 data URI.')
    // base64 grows by 4/3; allow the header on top.
    .max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 64),
});
export type LogoFile = z.infer<typeof LogoFileSchema>;

/** What the worker passes to a render: the library assets and logo files a spec uses. */
export const ResolvedAssetSchema = z.discriminatedUnion('kind', [
  LibraryAssetSchema,
  LogoFileSchema,
]);
export type ResolvedAsset = z.infer<typeof ResolvedAssetSchema>;

// ---------------------------------------------------------------------------------------------
// Missing assets (per run)

export const MISSING_ASSET_KINDS = ['asset', 'logo'] as const;

/** One place a missing id is used: the beat it is defined in and its JSON path in the spec. */
export const MissingAssetUseSchema = z.strictObject({
  beatId: SpecIdSchema,
  path: z.string().min(1),
});

/**
 * An id a render drew as a placeholder: an unknown library id (`asset`) or an unfilled logo
 * slot (`logo`). `label` is what the placeholder showed.
 */
export const MissingAssetSchema = z.strictObject({
  id: SpecIdSchema,
  kind: z.enum(MISSING_ASSET_KINDS),
  label: z.string().min(1),
  uses: z.array(MissingAssetUseSchema).min(1),
});
export type MissingAsset = z.infer<typeof MissingAssetSchema>;

/** `runs/<id>/missing-assets.json`: rewritten per render, merged per beat. */
export const MissingAssetListSchema = z.strictObject({
  items: z.array(MissingAssetSchema),
});
export type MissingAssetList = z.infer<typeof MissingAssetListSchema>;
