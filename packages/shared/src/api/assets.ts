import { z } from 'zod';
import {
  ASSET_DESCRIPTION_MAX,
  ASSET_MAX_ALIASES,
  AssetFamilySchema,
  LibraryAssetIdSchema,
} from '../domain/assets.ts';

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
