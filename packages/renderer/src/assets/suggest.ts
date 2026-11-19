import type { AssetFamily, LibraryAsset } from '@explainer-studio/shared';
import type { AssetRegistry } from './library.ts';

/**
 * Closest approved asset ids to an unknown one, for the `unknown_asset` message (agents repair
 * from it). Deterministic: a token score over the asset's id, name and tags, a bonus for how much
 * of the asset's id the query covers (`gpu_card` → `gpu` before `credit_card`) and a character
 * bigram similarity to its id; ties break by id. When the prop implies a family, assets of that
 * family come first. Only real matches are returned (none when nothing is close).
 */

export const SUGGESTION_LIMIT = 6;
/** Always suggest at least this many (when the library has them), relevant or not. */
/** Below this score an asset is not a real match and is never suggested. */
export const RELEVANT_SCORE = 1;

const EXACT = 3;
const PREFIX = 2;
const SUBSTRING = 1;
const BIGRAM_WEIGHT = 2;
const ID_COVERAGE_WEIGHT = 2;

export function suggestAssets(
  unknownId: string,
  registry: AssetRegistry,
  family?: AssetFamily,
): string[] {
  const query = tokens(unknownId);
  const relevant = [...registry.values()]
    .map((asset) => ({ asset, score: assetScore(unknownId, query, asset) }))
    .filter((s) => s.score >= RELEVANT_SCORE)
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));
  const ordered = family
    ? [
        ...relevant.filter((s) => s.asset.family === family),
        ...relevant.filter((s) => s.asset.family !== family),
      ]
    : relevant;
  return ordered.slice(0, SUGGESTION_LIMIT).map((s) => s.asset.id);
}

/** Each query token's best match among the asset's words, plus id similarity. */
export function assetScore(unknownId: string, query: readonly string[], asset: LibraryAsset) {
  const words = assetWords(asset);
  const tokenScore = query.reduce(
    (sum, q) => sum + Math.max(0, ...words.map((w) => match(q, w))),
    0,
  );
  return (
    tokenScore +
    ID_COVERAGE_WEIGHT * idCoverage(query, asset.id) +
    BIGRAM_WEIGHT * dice(unknownId.toLowerCase(), asset.id)
  );
}

/** Share of the asset's id words that some query word matches exactly or by prefix. */
function idCoverage(query: readonly string[], id: string): number {
  const idWords = tokens(id);
  const covered = idWords.filter((w) => query.some((q) => match(q, w) >= PREFIX));
  return idWords.length > 0 ? covered.length / idWords.length : 0;
}

function match(query: string, word: string): number {
  if (query === word) return EXACT;
  const [short, long] = query.length <= word.length ? [query, word] : [word, query];
  if (short.length >= 2 && long.startsWith(short)) return PREFIX;
  if (short.length >= 3 && long.includes(short)) return SUBSTRING;
  return 0;
}

function assetWords(asset: LibraryAsset): string[] {
  return [...new Set([asset.id, asset.name, ...asset.tags].flatMap(tokens))];
}

/** Lowercase words split on anything that is not a letter or digit. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Sørensen–Dice coefficient over character bigrams (0..1). */
function dice(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) return a === b ? 1 : 0;
  const pool = [...right];
  let shared = 0;
  for (const gram of left) {
    const i = pool.indexOf(gram);
    if (i >= 0) {
      shared++;
      pool.splice(i, 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

function bigrams(text: string): string[] {
  return Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2));
}
