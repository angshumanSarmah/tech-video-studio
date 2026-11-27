import {
  assetContext,
  mergeMissingAssets,
  missingAssets,
  specAssetUses,
} from '@explainer-studio/renderer/catalog';
import {
  MissingAssetListSchema,
  type LibraryAsset,
  type MissingAsset,
  type ResolvedAsset,
  type VideoSpec,
} from '@explainer-studio/shared';
import { existsSync } from 'node:fs';
import { missingAssetsPath, readDataJson, resolveDataPath, writeDataJson } from '../data-files.ts';
import type { Db } from '../db/client.ts';
import { loadAssetLibrary, type AssetProblem } from './library.ts';
import { loadLogoFiles } from './logo-file.ts';

export type RenderAssets = {
  /** The composition's `assets` prop: only what the spec uses. */
  assets: ResolvedAsset[];
  /** Ids the render will draw as placeholders (unknown ids, unfilled logo slots). */
  missing: MissingAsset[];
  /** Files that failed to load (they are missing too). */
  problems: AssetProblem[];
};

/**
 * Resolves a run's spec against the library and its logo files, for a render (P1A.12). A draft
 * render records `missing` with `recordMissingAssets`; a final render refuses when it is not
 * empty (placeholders are draft-only).
 */
export function prepareRenderAssets(
  db: Db,
  dataDir: string,
  runId: number,
  spec: VideoSpec,
): RenderAssets {
  const ids = [...new Set(specAssetUses(spec).map((use) => use.id))];
  const library = loadAssetLibrary(db, dataDir, ids);
  const logos = loadLogoFiles(dataDir, runId, spec.logos ?? []);
  const assets: ResolvedAsset[] = [...library.assets.map(forRender), ...logos.logos];
  return {
    assets,
    missing: missingAssets(spec, assetContext(spec.logos, assets)),
    problems: [...library.problems, ...logos.problems],
  };
}

/**
 * A library asset as a render receives it: what it draws, without the library-only fields
 * (aliases, description), so render props and draft cache keys do not change when they do.
 */
function forRender(asset: LibraryAsset): LibraryAsset {
  const { kind, id, name, family, tags, styleVersion, licence, source, shapes } = asset;
  return { kind, id, name, family, tags, styleVersion, licence, source, shapes };
}

/** The run's missing-assets list (empty before its first render). */
export function readMissingAssets(dataDir: string, runId: number): MissingAsset[] {
  const relPath = missingAssetsPath(runId);
  if (!existsSync(resolveDataPath(dataDir, relPath))) return [];
  return MissingAssetListSchema.parse(readDataJson(dataDir, relPath)).items;
}

/**
 * Records a render's missing assets in `runs/<id>/missing-assets.json`: a whole-video render
 * replaces the list, a per-beat render (`beatIds`) only those beats' uses. Returns the new list.
 */
export function recordMissingAssets(
  dataDir: string,
  runId: number,
  missing: readonly MissingAsset[],
  beatIds?: readonly string[],
): MissingAsset[] {
  const items = mergeMissingAssets(readMissingAssets(dataDir, runId), missing, beatIds);
  writeDataJson(dataDir, missingAssetsPath(runId), MissingAssetListSchema.parse({ items }));
  return items;
}
