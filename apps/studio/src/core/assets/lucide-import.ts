import { HOUSE_STYLE_VERSION, LUCIDE_VERSION } from '@explainer-studio/renderer/catalog';
import type { LibraryAsset } from '@explainer-studio/shared';
import { icons } from 'lucide';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findWorkspaceRoot } from '../workspace-root.ts';
import {
  houseShapes,
  importEntries,
  LucideManifestSchema,
  pascalName,
  type LucideIcons,
  type LucideManifest,
} from './lucide-manifest.ts';

/** The committed manifest, relative to the workspace root. */
export const LUCIDE_MANIFEST_PATH = 'apps/studio/seed/assets/lucide.manifest.json';

export function defaultLucideManifestPath(): string {
  return join(findWorkspaceRoot(import.meta.dirname), LUCIDE_MANIFEST_PATH);
}

/** The manifest's text and its parsed form (the text is hashed for the seeding skip). */
export function readLucideManifest(path = defaultLucideManifestPath()): {
  text: string;
  manifest: LucideManifest;
} {
  const text = readFileSync(path, 'utf8');
  return { text, manifest: LucideManifestSchema.parse(JSON.parse(text)) };
}

/**
 * The imported icons as library assets, their shapes from the installed `lucide` package.
 * Throws when the installed Lucide is not the release the manifest was built from (run
 * `assets:manifest` after a Lucide upgrade and review the diff).
 */
export function lucideImportAssets(
  manifest: LucideManifest,
  lucideIcons: LucideIcons = icons,
  installedVersion: string = LUCIDE_VERSION,
): LibraryAsset[] {
  if (manifest.lucideVersion !== installedVersion) {
    throw new Error(
      `The Lucide manifest is for lucide@${manifest.lucideVersion}, but ${installedVersion} is ` +
        'installed: run `pnpm --filter @explainer-studio/studio assets:manifest`.',
    );
  }
  return importEntries(manifest).map((entry) => {
    const node = lucideIcons[pascalName(entry.lucide)];
    const shapes = node ? houseShapes(entry.lucide, node) : undefined;
    if (!shapes) throw new Error(`Lucide icon "${entry.lucide}" cannot be imported.`);
    const { id, name, family, tags, licence } = entry;
    return {
      kind: 'library',
      ...{ id, name, family, tags, licence },
      styleVersion: HOUSE_STYLE_VERSION,
      source: `lucide@${manifest.lucideVersion}:${entry.lucide}`,
      shapes,
    };
  });
}
