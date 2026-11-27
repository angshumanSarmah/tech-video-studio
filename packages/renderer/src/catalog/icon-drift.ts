import { toJsonPath, type VideoSpec } from '@explainer-studio/shared';
import { specAssetUses, type AssetUse } from './asset-uses.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

/**
 * Icon drift (P1C.12): one thing drawn with different icons on different beats ("SHARED STORE"
 * as `memory` on one board and `database` on the next, from boards drawn in parallel). Things
 * are matched by the normalised text beside the icon: the `title`, `label` or `caption` of the
 * object that holds the asset id (a card, an item, a row or slot). For each text whose icons
 * differ across beats, every use takes the id used most (the earliest beat's on a tie). Only
 * loose elements count (pattern instances draw their own); logo slots are never changed. Pure
 * and deterministic.
 */

export type IconSwap = {
  readonly beatId: string;
  /** JSON path of the asset id in the spec. */
  readonly path: string;
  /** The same path as keys, for `withIconSwaps`. */
  readonly at: readonly PropertyKey[];
  readonly title: string;
  readonly from: string;
  readonly to: string;
};

const TEXT_KEYS = ['title', 'label', 'caption'] as const;

export function iconDrift(
  spec: VideoSpec,
  registries: Registries = DEFAULT_REGISTRIES,
  options: { readonly beatIds?: ReadonlySet<string> } = {},
): IconSwap[] {
  const slots = new Set((spec.logos ?? []).map((l) => l.id));
  const order = new Map(spec.story.beats.map((b, i) => [b.id, i]));
  const groups = new Map<string, { use: AssetUse; title: string }[]>();
  for (const use of specAssetUses(spec, registries)) {
    if (use.path[2] !== 'elements' || slots.has(use.id)) continue;
    const title = textBeside(spec, use.path);
    if (title === undefined) continue;
    const key = normaliseTitle(title);
    if (key === '') continue;
    groups.set(key, [...(groups.get(key) ?? []), { use, title }]);
  }
  return [...groups.values()].flatMap((group) => {
    const beats = new Set(group.map((g) => g.use.beatId));
    const ids = new Set(group.map((g) => g.use.id));
    if (beats.size < 2 || ids.size < 2) return [];
    const to = mostUsed(
      group.map((g) => g.use),
      order,
    );
    return group
      .filter((g) => g.use.id !== to && (options.beatIds?.has(g.use.beatId) ?? true))
      .map((g) => ({
        beatId: g.use.beatId,
        path: toJsonPath(g.use.path),
        at: g.use.path,
        title: g.title,
        from: g.use.id,
        to,
      }));
  });
}

/** Upper or lower case, spacing and punctuation aside: "Shared store" is "SHARED STORE". */
export function normaliseTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The id with most uses; on a tie, the one whose first use is on the earliest beat. */
function mostUsed(uses: readonly AssetUse[], order: ReadonlyMap<string, number>): string {
  const stats = new Map<string, { count: number; first: number }>();
  for (const use of uses) {
    const at = order.get(use.beatId) ?? Number.MAX_SAFE_INTEGER;
    const s = stats.get(use.id) ?? { count: 0, first: at };
    stats.set(use.id, { count: s.count + 1, first: Math.min(s.first, at) });
  }
  return [...stats].sort(([, a], [, b]) => b.count - a.count || a.first - b.first)[0]![0];
}

/** The `title`, `label` or `caption` of the object holding the asset id at `path`. */
function textBeside(spec: VideoSpec, path: readonly PropertyKey[]): string | undefined {
  const holder = path.slice(0, -1).reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined;
    return (node as Record<PropertyKey, unknown>)[key];
  }, spec);
  if (holder === null || typeof holder !== 'object') return undefined;
  for (const key of TEXT_KEYS) {
    const text = (holder as Record<string, unknown>)[key];
    if (typeof text === 'string' && text.trim() !== '') return text;
  }
  return undefined;
}

/**
 * A copy of the spec with each swap applied; a board's asset request whose id the board no
 * longer uses is dropped with it.
 */
export function withIconSwaps(
  spec: VideoSpec,
  swaps: readonly IconSwap[],
  registries: Registries = DEFAULT_REGISTRIES,
): VideoSpec {
  if (swaps.length === 0) return spec;
  const copy = structuredClone(spec);
  for (const swap of swaps) {
    const parent = swap.at.slice(0, -1).reduce<unknown>((node, key) => {
      return node !== null && typeof node === 'object'
        ? (node as Record<PropertyKey, unknown>)[key]
        : undefined;
    }, copy);
    const last = swap.at.at(-1);
    if (parent !== null && typeof parent === 'object' && last !== undefined) {
      (parent as Record<PropertyKey, unknown>)[last] = swap.to;
    }
  }
  const uses = specAssetUses(copy, registries);
  for (const scene of copy.scenes ?? []) {
    if (!scene.missingAssetRequests) continue;
    const used = new Set(uses.filter((u) => u.beatId === scene.beatId).map((u) => u.id));
    const kept = scene.missingAssetRequests.filter((r) => used.has(r.assetId));
    if (kept.length > 0) scene.missingAssetRequests = kept;
    else delete scene.missingAssetRequests;
  }
  return copy;
}
