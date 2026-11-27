import {
  SEED_REGISTRY,
  SEED_SOURCE_PREFIX,
  type Registries,
} from '@explainer-studio/renderer/catalog';

/**
 * The registries the Generator's system prompt lists (P1C.12, until A2 moves the asset list to
 * the user message): the core seed set plus assets that are not part of an icon-set import
 * (drafted and uploaded ones), never the ~1,750 imported Lucide icons, so the cached prefix stays
 * as it was. Checks and validation still use the whole approved library: an imported id the
 * Generator names (from an `unknown_asset` suggestion, say) is accepted.
 */
export function promptRegistries(registries: Registries): Registries {
  const listed = [...registries.assets].filter(
    ([id, asset]) => SEED_REGISTRY.has(id) || !asset.source.startsWith(SEED_SOURCE_PREFIX),
  );
  return { ...registries, assets: new Map(listed) };
}
