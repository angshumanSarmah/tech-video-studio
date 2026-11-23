import { nearIdenticalAsset } from '../assets/near-identical.ts';
import type { Registries } from './registries.ts';
import { paramLeaves, propLeaves } from './schema-leaves.ts';

/**
 * Near-identical asset ids on one board (`nearIdenticalAsset`), with where each is used, so the
 * Generator's step swaps them before its checks and logs each swap. Paths are relative to the
 * board (`elements[j].props...`, `patterns[j].params...`). Pure.
 */

type Path = (string | number)[];

export type AssetSwap = { path: Path; from: string; to: string };

type Board = {
  elements: readonly { primitive: string; props?: unknown }[];
  patterns: readonly { pattern: string; params?: unknown }[];
};

export function boardAssetSwaps(
  board: Board,
  registries: Registries,
  logoSlots: ReadonlySet<string> = new Set(),
  aliases?: ReadonlyMap<string, string>,
): AssetSwap[] {
  const leaves = [
    ...board.elements.flatMap((element, j) => {
      const definition = registries.primitives.get(element.primitive);
      if (!definition) return [];
      return propLeaves(definition, element.props ?? {}).map((l) => ({
        ...l,
        path: ['elements', j, 'props', ...l.path],
      }));
    }),
    ...board.patterns.flatMap((pattern, j) => {
      const definition = registries.patterns.get(pattern.pattern);
      if (!definition) return [];
      return paramLeaves(definition, pattern.params ?? {}).map((l) => ({
        ...l,
        path: ['patterns', j, 'params', ...l.path],
      }));
    }),
  ];
  return leaves.flatMap((leaf) => {
    if (leaf.kind !== 'asset' || logoSlots.has(leaf.value)) return [];
    const to = nearIdenticalAsset(leaf.value, registries.assets, aliases);
    return to ? [{ path: leaf.path, from: leaf.value, to }] : [];
  });
}

/** A copy of `value` with each swap applied at its path. */
export function withAssetSwaps<T>(value: T, swaps: readonly AssetSwap[]): T {
  if (swaps.length === 0) return value;
  const copy = structuredClone(value);
  for (const { path, to } of swaps) setAt(copy, path, to);
  return copy;
}

function setAt(root: unknown, path: Path, value: string): void {
  const parent = path
    .slice(0, -1)
    .reduce<unknown>(
      (node, key) => (node as Record<string | number, unknown> | undefined)?.[key],
      root,
    );
  const last = path.at(-1);
  if (parent && typeof parent === 'object' && last !== undefined) {
    (parent as Record<string | number, unknown>)[last] = value;
  }
}
