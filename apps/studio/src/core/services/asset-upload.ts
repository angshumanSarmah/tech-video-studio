import {
  aliasProblems,
  HOUSE_STYLE_VERSION,
  sanitizeAssetSvg,
} from '@explainer-studio/renderer/catalog';
import { toJsonPath, UploadAssetRequestSchema } from '@explainer-studio/shared';
import { eq } from 'drizzle-orm';
import { assetSvgPath, writeDataText } from '../data-files.ts';
import type { Db } from '../db/client.ts';
import { assets } from '../db/schema.ts';
import { ConflictError, InvalidEditError } from '../errors.ts';

export type AssetRow = typeof assets.$inferSelect;

export interface UploadedAsset {
  readonly asset: AssetRow;
  /** What the sanitizer changed (editor leftovers dropped, groups flattened). */
  readonly fixes: readonly string[];
}

/**
 * Adds an SVG to the library by hand (P1C.12): the request checked, the file through the asset
 * sanitizer (`sanitizeAssetSvg`, upload mode: anything unsafe refused, harmless leftovers fixed),
 * stored as canonical house SVG at `assets/<id>.svg` and inserted as an approved row. An id that
 * exists (any status) is a `ConflictError`; an invalid request, a file the sanitizer refuses or
 * aliases another asset already has are an `InvalidEditError` with every issue; nothing is
 * written then.
 */
export function uploadAsset(db: Db, dataDir: string, input: unknown): UploadedAsset {
  const parsed = UploadAssetRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidEditError(
      'The asset cannot be added: its details are not valid.',
      parsed.error.issues.map((i) => ({ path: toJsonPath(i.path), message: i.message })),
    );
  }
  const request = parsed.data;
  const clean = sanitizeAssetSvg(request.svg, 'upload');
  if (!clean.ok) {
    throw new InvalidEditError(
      'The SVG cannot be added to the library.',
      clean.problems.map((message) => ({ path: '$.svg', message })),
    );
  }
  return db.transaction((tx) => {
    const existing = tx
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, request.id))
      .get();
    if (existing) throw new ConflictError(`Asset "${request.id}" already exists.`);
    const library = tx.select({ id: assets.id, aliases: assets.aliases }).from(assets).all();
    const problems = aliasProblems([...library, { id: request.id, aliases: request.aliases }]);
    if (problems.length > 0) {
      throw new InvalidEditError(
        'The asset cannot be added: its aliases are taken.',
        problems.map((message) => ({ path: '$.aliases', message })),
      );
    }
    const svgPath = writeDataText(dataDir, assetSvgPath(request.id), clean.svg);
    const { id, name, family, tags, aliases, description, licence, source } = request;
    const asset = tx
      .insert(assets)
      .values({
        ...{ id, name, family, tags, aliases, licence, source, svgPath },
        ...(description ? { description } : {}),
        styleVersion: HOUSE_STYLE_VERSION,
        status: 'approved',
      })
      .returning()
      .get();
    return { asset, fixes: clean.fixes };
  });
}
