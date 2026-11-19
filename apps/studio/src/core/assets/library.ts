import { parseHouseSvg } from '@explainer-studio/renderer/catalog';
import { LibraryAssetSchema, type LibraryAsset } from '@explainer-studio/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { readDataText } from '../data-files.ts';
import type { Db } from '../db/client.ts';
import { assets } from '../db/schema.ts';

/** An asset or logo that could not be loaded; it is drawn as a placeholder instead. */
export type AssetProblem = { id: string; message: string };

export type LibraryLoad = { assets: LibraryAsset[]; problems: AssetProblem[] };

/**
 * Approved library assets with their parsed house SVG, optionally only `ids`. An asset whose
 * file is missing or breaks the house format is left out and reported, never thrown: the render
 * then shows its placeholder and lists it as missing.
 */
export function loadAssetLibrary(db: Db, dataDir: string, ids?: readonly string[]): LibraryLoad {
  if (ids?.length === 0) return { assets: [], problems: [] };
  const approved = eq(assets.status, 'approved');
  const rows = db
    .select()
    .from(assets)
    .where(ids ? and(approved, inArray(assets.id, [...ids])) : approved)
    .orderBy(assets.id)
    .all();
  const load: LibraryLoad = { assets: [], problems: [] };
  for (const row of rows) {
    const loaded = loadRow(row, dataDir);
    if ('asset' in loaded) load.assets.push(loaded.asset);
    else load.problems.push({ id: row.id, message: loaded.problem });
  }
  return load;
}

function loadRow(
  row: typeof assets.$inferSelect,
  dataDir: string,
): { asset: LibraryAsset } | { problem: string } {
  let text: string;
  try {
    text = readDataText(dataDir, row.svgPath);
  } catch (error) {
    return { problem: `Cannot read ${row.svgPath}: ${(error as Error).message}` };
  }
  const svg = parseHouseSvg(text);
  if (!svg.ok) return { problem: `${row.svgPath}: ${svg.problems.join(' ')}` };
  const { id, name, family, tags, styleVersion, licence, source } = row;
  const parsed = LibraryAssetSchema.safeParse({
    kind: 'library',
    ...{ id, name, family, tags, styleVersion, licence, source },
    shapes: svg.shapes,
  });
  return parsed.success ? { asset: parsed.data } : { problem: parsed.error.message };
}
