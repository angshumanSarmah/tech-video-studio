import { createContext, useContext, type ReactNode } from 'react';
import { SEED_ASSET_CONTEXT, type AssetContextValue } from './library.ts';

/**
 * The render's assets, provided once by `SpecLayers` (from the composition's `assets` prop and
 * the spec's logo slots). Without a provider (primitive sheets) the seed library is used.
 */
const AssetContext = createContext<AssetContextValue>(SEED_ASSET_CONTEXT);

export function AssetProvider({
  value,
  children,
}: {
  value: AssetContextValue;
  children: ReactNode;
}) {
  return <AssetContext.Provider value={value}>{children}</AssetContext.Provider>;
}

export function useAssetContext(): AssetContextValue {
  return useContext(AssetContext);
}
