import {
  buildAssetRegistry,
  DEFAULT_REGISTRIES,
  generatorCatalogueBlock,
  SEED_ASSETS,
} from '@explainer-studio/renderer/catalog';
import type { LibraryAsset } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { lucideImportAssets, readLucideManifest } from '#core/assets/lucide-import.ts';
import { promptRegistries } from './prompt-assets.ts';

const imported = lucideImportAssets(readLucideManifest().manifest);
const drafted: LibraryAsset = {
  ...(SEED_ASSETS[0] as LibraryAsset),
  id: 'worker_thread',
  name: 'Worker thread',
  licence: 'LicenseRef-own',
  source: 'drafted',
};
const library = buildAssetRegistry([...SEED_ASSETS, ...imported, drafted]);
const registries = { ...DEFAULT_REGISTRIES, assets: library };

describe('promptRegistries', () => {
  it('lists the core seed set and drafted assets, never the Lucide import', () => {
    const listed = promptRegistries(registries).assets;
    expect(listed.size).toBe(SEED_ASSETS.length + 1);
    expect(listed.has('worker_thread')).toBe(true);
    expect(listed.has('snail')).toBe(false);
    expect(registries.assets.has('snail')).toBe(true);
  });

  it('keeps the Generator system prompt as it was before the import', () => {
    expect(
      generatorCatalogueBlock(
        promptRegistries({
          ...DEFAULT_REGISTRIES,
          assets: buildAssetRegistry([...SEED_ASSETS, ...imported]),
        }),
      ),
    ).toBe(generatorCatalogueBlock(DEFAULT_REGISTRIES));
  });
});
