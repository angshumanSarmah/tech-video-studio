import {
  queryTerms,
  SOURCE_CHARS_PER_TOKEN,
  termWords,
  type OmittedChunk,
} from '@explainer-studio/shared';

/** Content words of the topic and angle (shared `text/terms.ts`). */
export { queryTerms };

/**
 * Source token budget (pure, deterministic). When the pinned chunks exceed the budget, each
 * source gets a fair share (max-min: sources smaller than their share keep everything and pass
 * the rest on), keeps its first chunks (title, intro, usually the definitions), and fills the
 * rest of its share with the chunks most relevant to the topic and angle. Kept chunks stay in
 * their original order. The first chunks are kept even past a source's share, so with many
 * sources and a small budget the kept total can exceed the budget (it never drops a source).
 */

/** Leading chunks of each source that are always kept. */
export const KEEP_FIRST_CHUNKS = 2;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / SOURCE_CHARS_PER_TOKEN);
}

export interface SelectableChunk {
  readonly id: string;
  readonly text: string;
}

export interface SelectableSource<C extends SelectableChunk = SelectableChunk> {
  readonly sourceId: number;
  readonly chunks: readonly C[];
}

export interface ChunkSelection<S extends SelectableSource> {
  /** Every source, with only its kept chunks, in input order. */
  readonly sources: S[];
  readonly omitted: OmittedChunk[];
  readonly sourceTokens: number;
  readonly keptTokens: number;
}

export function selectChunks<S extends SelectableSource>(
  sources: readonly S[],
  options: { readonly budgetTokens: number; readonly query: string },
): ChunkSelection<S> {
  const tokens = sources.map((s) => s.chunks.map((c) => estimateTokens(c.text)));
  const totals = tokens.map(sum);
  const sourceTokens = sum(totals);
  if (sourceTokens <= options.budgetTokens) {
    return { sources: [...sources], omitted: [], sourceTokens, keptTokens: sourceTokens };
  }
  const shares = fairShares(totals, options.budgetTokens);
  const terms = queryTerms(options.query);
  const kept = sources.map((source, i) => pickChunks(source.chunks, tokens[i]!, shares[i]!, terms));
  return {
    sources: sources.map((source, i) => ({
      ...source,
      chunks: source.chunks.filter((_, j) => kept[i]![j]),
    })),
    omitted: sources.flatMap((source, i) =>
      source.chunks.flatMap((chunk, j) =>
        kept[i]![j] ? [] : [{ id: chunk.id, sourceId: source.sourceId, tokens: tokens[i]![j]! }],
      ),
    ),
    sourceTokens,
    keptTokens: sum(tokens.flatMap((t, i) => t.filter((_, j) => kept[i]![j]))),
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Max-min fair split of the budget: the smallest sources take all they need, the rest share
 * what remains equally. Ties are broken by input order, so the result is deterministic.
 */
export function fairShares(totals: readonly number[], budget: number): number[] {
  const shares = totals.map(() => 0);
  const open = totals.map((_, i) => i).sort((a, b) => totals[a]! - totals[b]! || a - b);
  let remaining = budget;
  while (open.length > 0) {
    const share = Math.floor(remaining / open.length);
    const smallest = open[0]!;
    if (totals[smallest]! > share) {
      for (const i of open) shares[i] = share;
      break;
    }
    shares[smallest] = totals[smallest]!;
    remaining -= totals[smallest]!;
    open.shift();
  }
  return shares;
}

/** Which chunks of one source to keep within its share. */
function pickChunks(
  chunks: readonly SelectableChunk[],
  tokens: readonly number[],
  share: number,
  terms: readonly string[],
): boolean[] {
  const keep = chunks.map((_, j) => j < KEEP_FIRST_CHUNKS);
  let used = sum(tokens.slice(0, KEEP_FIRST_CHUNKS));
  const ranked = chunks
    .map((chunk, j) => ({ j, ...relevance(chunk.text, terms) }))
    .slice(KEEP_FIRST_CHUNKS)
    .sort((a, b) => b.matched - a.matched || b.density - a.density || a.j - b.j);
  for (const { j } of ranked) {
    if (used + tokens[j]! > share) continue;
    keep[j] = true;
    used += tokens[j]!;
  }
  return keep;
}

/** How many query terms a chunk mentions, then how densely (hits per word). */
export function relevance(
  text: string,
  terms: readonly string[],
): { matched: number; density: number } {
  const counts = new Map<string, number>();
  const tokens = termWords(text);
  for (const w of tokens) counts.set(w, (counts.get(w) ?? 0) + 1);
  const hits = terms.map((t) => counts.get(t) ?? 0);
  return {
    matched: hits.filter((h) => h > 0).length,
    density: tokens.length === 0 ? 0 : sum(hits) / tokens.length,
  };
}
