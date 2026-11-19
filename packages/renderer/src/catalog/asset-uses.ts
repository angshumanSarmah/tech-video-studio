import {
  toJsonPath,
  type AssetFamily,
  type MissingAsset,
  type SceneElement,
  type SpecError,
  type VideoSpec,
} from '@explainer-studio/shared';
import type { AnyPatternDefinition } from '../patterns/types.ts';
import { placeholderLabel, type AssetContextValue } from '../assets/library.ts';
import { suggestAssets } from '../assets/suggest.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

/**
 * Every asset id a spec uses, found once from each primitive's `assetRefs` (loose elements and
 * pattern expansions). The `unknown_asset` warning and the per-run missing-assets list both read
 * it, so they never disagree.
 */

type Path = PropertyKey[];

export type AssetUse = {
  id: string;
  beatId: string;
  /** Into the props (loose elements) or to the instance's params (patterns). */
  path: Path;
  /** Element id; `<instance>/<id>` inside a pattern. */
  element: string;
  /** The family the prop implies, if any (`AssetRef.family`). */
  family?: AssetFamily;
};

/** Asset uses of one loose element with valid props (bad props are errors already). */
export function elementAssetUses(
  element: Pick<SceneElement, 'id' | 'primitive' | 'props'>,
  path: Path,
  beatId: string,
  registries: Registries,
): AssetUse[] {
  const definition = registries.primitives.get(element.primitive);
  if (!definition?.assetRefs) return [];
  const props = definition.propsSchema.safeParse(element.props);
  if (!props.success) return [];
  return definition.assetRefs(props.data).map((ref) => ({
    id: ref.id,
    beatId,
    path: [...path, 'props', ...ref.path],
    element: element.id,
    ...(ref.family ? { family: ref.family } : {}),
  }));
}

/** Asset uses inside a valid pattern instance, all located at its `params`. */
export function patternAssetUses(
  instanceId: string,
  definition: AnyPatternDefinition,
  params: unknown,
  path: Path,
  beatId: string,
  registries: Registries,
): AssetUse[] {
  return definition.expand(params).elements.flatMap((element) =>
    elementAssetUses(element, path, beatId, registries).map((use) => ({
      ...use,
      path,
      element: `${instanceId}/${element.id}`,
    })),
  );
}

/** Every asset use in the spec's scenes, in scene order (elements, then patterns). */
export function specAssetUses(
  spec: VideoSpec,
  registries: Registries = DEFAULT_REGISTRIES,
): AssetUse[] {
  return (spec.scenes ?? []).flatMap((scene, i) => [
    ...scene.elements.flatMap((element, j) =>
      elementAssetUses(element, ['scenes', i, 'elements', j], scene.beatId, registries),
    ),
    ...scene.patterns.flatMap((pattern, j) => {
      const definition = registries.patterns.get(pattern.pattern);
      const params = definition?.paramsSchema.safeParse(pattern.params);
      if (!definition || !params?.success) return [];
      const path = ['scenes', i, 'patterns', j, 'params'];
      return patternAssetUses(pattern.id, definition, params.data, path, scene.beatId, registries);
    }),
  ]);
}

/** Ids that are neither library assets nor logo slots the spec declares. */
export function unknownAssetWarnings(
  uses: readonly AssetUse[],
  spec: VideoSpec,
  registries: Registries,
): SpecError[] {
  const slots = new Set((spec.logos ?? []).map((l) => l.id));
  const unknown = uses.filter((u) => !registries.assets.has(u.id) && !slots.has(u.id));
  const logos = slots.size > 0 ? ` Logo slots: ${[...slots].join(', ')}.` : '';
  return unknown.map((use) => ({
    path: toJsonPath(use.path),
    code: 'unknown_asset',
    message:
      `Unknown asset "${use.id}"${innerSuffix(use.element)} (drawn as a placeholder). ` +
      `${suggestionText(use, registries)}${logos}`,
  }));
}

export const NO_CLOSE_ASSET =
  'No close match. Pick from the asset list in your catalogue, or request a new asset.';

/** The closest approved ids, or `NO_CLOSE_ASSET` when nothing really matches. */
function suggestionText(use: AssetUse, registries: Registries): string {
  const closest = suggestAssets(use.id, registries.assets, use.family);
  if (closest.length === 0) return NO_CLOSE_ASSET;
  return `Closest approved ids: ${closest.join(', ')}. See the asset list in your catalogue.`;
}

/** ` on "<id>"` for an element inside a pattern (the path points only to its params). */
function innerSuffix(element: string): string {
  const slash = element.indexOf('/');
  return slash < 0 ? '' : ` on "${element.slice(slash + 1)}"`;
}

/**
 * Ids a render draws as placeholders, with where each is used: unknown library ids (`asset`) and
 * declared logo slots without a file (`logo`). `assets` is the render's asset context, so the
 * list matches what the render shows.
 */
export function missingAssets(
  spec: VideoSpec,
  assets: AssetContextValue,
  registries: Registries = DEFAULT_REGISTRIES,
): MissingAsset[] {
  const byId = new Map<string, MissingAsset>();
  for (const use of specAssetUses(spec, registries)) {
    const entry = missingEntry(use.id, assets);
    if (!entry) continue;
    const existing = byId.get(use.id) ?? { ...entry, uses: [] };
    existing.uses.push({ beatId: use.beatId, path: toJsonPath(use.path) });
    byId.set(use.id, existing);
  }
  return [...byId.values()];
}

function missingEntry(
  id: string,
  { library, logos }: AssetContextValue,
): Omit<MissingAsset, 'uses'> | undefined {
  if (library.has(id)) return undefined;
  const slot = logos.get(id);
  if (slot) return slot.file ? undefined : { id, kind: 'logo', label: slot.label };
  return { id, kind: 'asset', label: placeholderLabel(id) };
}

/**
 * Merges a render's missing assets into the run's list. A whole-video render (`beatIds`
 * omitted) replaces it; a per-beat render replaces only the uses in the beats it rendered.
 */
export function mergeMissingAssets(
  previous: readonly MissingAsset[],
  current: readonly MissingAsset[],
  beatIds?: readonly string[],
): MissingAsset[] {
  if (!beatIds) return current.map((m) => ({ ...m, uses: [...m.uses] }));
  const rendered = new Set(beatIds);
  const merged = new Map<string, MissingAsset>();
  const add = (item: MissingAsset, keep: (beatId: string) => boolean) => {
    const uses = item.uses.filter((u) => keep(u.beatId));
    if (uses.length === 0) return;
    const existing = merged.get(item.id);
    // The latest render's kind and label win (e.g. a logo slot declared since).
    merged.set(item.id, { ...item, uses: [...(existing?.uses ?? []), ...uses] });
  };
  for (const item of previous) add(item, (beatId) => !rendered.has(beatId));
  for (const item of current) add(item, (beatId) => rendered.has(beatId));
  return [...merged.values()];
}
