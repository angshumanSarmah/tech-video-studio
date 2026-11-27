import { LOGO_ID_PREFIX } from '@explainer-studio/shared';
import type { AssetRegistry } from './library.ts';

/**
 * Asset aliases (P1C.12): other ids that name the same glyph (`gpu_card` -> `gpu`). Only the
 * Generator's near-identical substitution reads them (`nearIdenticalAsset`); a render resolves
 * ids exactly. An alias is unique across the library: never an asset's id, never another
 * asset's alias, never a logo slot id.
 */

type AliasHolder = { readonly id: string; readonly aliases?: readonly string[] | undefined };

const indexes = new WeakMap<AssetRegistry, ReadonlyMap<string, string>>();

/** Alias -> asset id for a registry, built once per registry object. */
export function aliasIndex(registry: AssetRegistry): ReadonlyMap<string, string> {
  const cached = indexes.get(registry);
  if (cached) return cached;
  const index = new Map<string, string>();
  for (const asset of registry.values()) {
    for (const alias of asset.aliases ?? []) index.set(alias, asset.id);
  }
  indexes.set(registry, index);
  return index;
}

/** Every way a set of assets breaks alias uniqueness, one line each (empty when clean). */
export function aliasProblems(assets: Iterable<AliasHolder>): string[] {
  const list = [...assets];
  const ids = new Set(list.map((a) => a.id));
  const owner = new Map<string, string>();
  const problems: string[] = [];
  for (const asset of list) {
    for (const alias of asset.aliases ?? []) {
      if (alias === asset.id) problems.push(`Asset "${asset.id}" lists its own id as an alias.`);
      else if (ids.has(alias)) {
        problems.push(`Alias "${alias}" of "${asset.id}" is the id of another asset.`);
      } else if (alias.startsWith(LOGO_ID_PREFIX)) {
        problems.push(`Alias "${alias}" of "${asset.id}" starts with "${LOGO_ID_PREFIX}".`);
      }
      const first = owner.get(alias);
      if (first !== undefined && first !== asset.id) {
        problems.push(`Alias "${alias}" is declared by both "${first}" and "${asset.id}".`);
      } else if (first === asset.id) {
        problems.push(`Asset "${asset.id}" lists alias "${alias}" twice.`);
      }
      owner.set(alias, asset.id);
    }
  }
  return problems;
}
