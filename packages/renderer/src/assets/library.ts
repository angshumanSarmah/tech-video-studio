import {
  LibraryAssetSchema,
  LOGO_ID_PREFIX,
  type LibraryAsset,
  type LogoFile,
  type LogoSlot,
  type ResolvedAsset,
} from '@explainer-studio/shared';
import { aliasProblems } from './aliases.ts';
import { SEED_ASSETS } from './seed.ts';

/**
 * Asset lookup, React-free: validation reads the ids (`unknown_asset`), the scene layer draws
 * them. The library comes from the studio's `assets` table at run time (passed to a render as
 * props) or from the seed set when nothing is passed.
 */

export type AssetRegistry = ReadonlyMap<string, LibraryAsset>;

/**
 * Throws on a duplicate id, an invalid asset or aliases that are not unique (a broken library
 * must fail loudly).
 */
export function buildAssetRegistry(assets: readonly LibraryAsset[]): AssetRegistry {
  const registry = new Map<string, LibraryAsset>();
  for (const asset of assets) {
    if (registry.has(asset.id)) throw new Error(`Duplicate asset id "${asset.id}"`);
    const parsed = LibraryAssetSchema.safeParse(asset);
    if (!parsed.success) throw new Error(`Invalid asset "${asset.id}": ${parsed.error.message}`);
    registry.set(asset.id, parsed.data);
  }
  const problems = aliasProblems(registry.values());
  if (problems.length > 0) throw new Error(`Asset aliases: ${problems.join(' ')}`);
  return registry;
}

export const SEED_REGISTRY: AssetRegistry = buildAssetRegistry(SEED_ASSETS);

/** What a render can draw: the library, plus the spec's logo slots and the files that fill them. */
export type AssetContextValue = {
  library: AssetRegistry;
  logos: ReadonlyMap<string, { label: string; file: LogoFile | undefined }>;
};

export const SEED_ASSET_CONTEXT: AssetContextValue = { library: SEED_REGISTRY, logos: new Map() };

/**
 * The render's asset context. Without `resolved` (Studio, stills, fixtures) the seed library is
 * used; with it, only the assets the worker resolved, so an id missing from the DB is drawn as a
 * placeholder exactly as in the real render.
 */
export function assetContext(
  slots: readonly LogoSlot[] | undefined,
  resolved: readonly ResolvedAsset[] | undefined,
): AssetContextValue {
  const library = resolved
    ? buildAssetRegistry(resolved.filter((a): a is LibraryAsset => a.kind === 'library'))
    : SEED_REGISTRY;
  const files = new Map(
    (resolved ?? []).filter((a): a is LogoFile => a.kind === 'logo').map((f) => [f.id, f]),
  );
  const logos = new Map(
    (slots ?? []).map((s) => [s.id, { label: s.label, file: files.get(s.id) }]),
  );
  return { library, logos };
}

export type GlyphSource =
  | { kind: 'library'; asset: LibraryAsset }
  | { kind: 'logo'; file: LogoFile; label: string }
  | { kind: 'placeholder'; label: string; reason: 'unknown_asset' | 'unfilled_logo' };

/** How to draw an asset id: library shapes, a logo file, or a labelled placeholder. */
export function resolveGlyph(id: string, context: AssetContextValue): GlyphSource {
  const asset = context.library.get(id);
  if (asset) return { kind: 'library', asset };
  const slot = context.logos.get(id);
  if (slot?.file) return { kind: 'logo', file: slot.file, label: slot.label };
  if (slot) return { kind: 'placeholder', label: slot.label, reason: 'unfilled_logo' };
  return { kind: 'placeholder', label: placeholderLabel(id), reason: 'unknown_asset' };
}

/** `rocket_ship` → `rocket ship`; a `logo_` prefix is dropped. */
export function placeholderLabel(id: string): string {
  const bare = id.startsWith(LOGO_ID_PREFIX) ? id.slice(LOGO_ID_PREFIX.length) : id;
  return bare.replace(/[_-]+/g, ' ').trim() || id;
}
