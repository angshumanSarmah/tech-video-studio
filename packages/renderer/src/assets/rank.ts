import type { AssetFamily, LibraryAsset } from '@explainer-studio/shared';
import type { AssetRegistry } from './library.ts';

/**
 * Ranks approved assets against a query (P1C.12): one scorer for the `unknown_asset`
 * suggestions (`suggestAssets`, agents repair from them), `suggestSwap` and the Generator's
 * per-beat list. Deterministic and pure: a token score over the asset's id, name, tags, aliases
 * and description, a bonus for how much of the asset's id the query covers (`gpu_card` -> `gpu`
 * before `credit_card`) and a character bigram similarity of the query id to its id; ties break
 * by id in code-unit order. When a family is given, its assets come first. Only real matches
 * (score at least `RELEVANT_SCORE`) are returned.
 */

export const SUGGESTION_LIMIT = 6;
/** Below this score an asset is not a real match and is never suggested. */
export const RELEVANT_SCORE = 1;

const EXACT = 3;
const PREFIX = 2;
const SUBSTRING = 1;
const BIGRAM_WEIGHT = 2;
const ID_COVERAGE_WEIGHT = 2;

/** What is looked for: an id (an unknown asset id), and/or free words (a name, a description). */
export type AssetQuery = {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
};

export type RankedAsset = { readonly id: string; readonly score: number };

export type RankOptions = {
  /** Assets of this family come first (the prop implies it). */
  readonly family?: AssetFamily | undefined;
  readonly limit?: number | undefined;
};

export function rankAssets(
  query: AssetQuery,
  registry: AssetRegistry,
  options: RankOptions = {},
): RankedAsset[] {
  const words = queryWords(query);
  const queryId = (query.id ?? slug(query.name ?? '')).toLowerCase();
  const relevant = [...registry.values()]
    .map((asset) => ({ asset, score: assetScore(queryId, words, asset) }))
    .filter((s) => s.score >= RELEVANT_SCORE)
    .sort((a, b) => b.score - a.score || byCodeUnits(a.asset.id, b.asset.id));
  const { family } = options;
  const ordered = family
    ? [
        ...relevant.filter((s) => s.asset.family === family),
        ...relevant.filter((s) => s.asset.family !== family),
      ]
    : relevant;
  const limited = options.limit === undefined ? ordered : ordered.slice(0, options.limit);
  return limited.map((s) => ({ id: s.asset.id, score: s.score }));
}

/** Closest approved ids to an unknown one, for the `unknown_asset` message. */
export function suggestAssets(
  unknownId: string,
  registry: AssetRegistry,
  family?: AssetFamily,
): string[] {
  return rankAssets({ id: unknownId }, registry, { family, limit: SUGGESTION_LIMIT }).map(
    (r) => r.id,
  );
}

/** Each query word's best match among the asset's words, plus id coverage and similarity. */
function assetScore(queryId: string, query: readonly string[], asset: LibraryAsset): number {
  const words = assetWords(asset);
  const tokenScore = query.reduce(
    (sum, q) => sum + Math.max(0, ...words.map((w) => match(q, w))),
    0,
  );
  const similarity = queryId ? dice(queryId, asset.id) : 0;
  return tokenScore + ID_COVERAGE_WEIGHT * idCoverage(query, asset.id) + BIGRAM_WEIGHT * similarity;
}

/** The query's distinct words, id words first. */
function queryWords(query: AssetQuery): string[] {
  const text = [query.id, query.name, query.description].filter((t) => t !== undefined);
  return [...new Set(text.flatMap(tokens))];
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
  const texts = [asset.id, asset.name, ...asset.tags, ...(asset.aliases ?? [])];
  if (asset.description) texts.push(asset.description);
  return [...new Set(texts.flatMap(tokens))];
}

/** Lowercase words split on anything that is not a letter or digit. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function slug(text: string): string {
  return tokens(text).join('_');
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

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
