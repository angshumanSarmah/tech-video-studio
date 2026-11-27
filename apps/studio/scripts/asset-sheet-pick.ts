import { ASSET_FAMILIES, type LibraryAsset } from '@explainer-studio/shared';

/**
 * Which assets a contact sheet shows (`assets:sheet`), deterministically: `count` assets taken
 * round-robin across families in `ASSET_FAMILIES` order, each family's picks spread evenly over
 * its assets sorted by id, so a sheet samples the whole library instead of its first letters.
 */
export function pickSheetAssets(assets: readonly LibraryAsset[], count: number): LibraryAsset[] {
  const byFamily = ASSET_FAMILIES.map((family) =>
    assets.filter((a) => a.family === family).sort((a, b) => (a.id < b.id ? -1 : 1)),
  );
  const quota = byFamily.map(() => 0);
  let left = Math.min(count, assets.length);
  while (left > 0) {
    for (let f = 0; f < byFamily.length && left > 0; f++) {
      if ((quota[f] ?? 0) < (byFamily[f]?.length ?? 0)) {
        quota[f] = (quota[f] ?? 0) + 1;
        left--;
      }
    }
  }
  return byFamily.flatMap((list, f) => spread(list, quota[f] ?? 0));
}

/** `n` items evenly spaced over `list` (the middle of each of `n` equal stretches). */
function spread<T>(list: readonly T[], n: number): T[] {
  if (n <= 0) return [];
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(step * i + step / 2)] as T);
}
