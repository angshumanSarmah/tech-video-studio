import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  fairShares,
  KEEP_FIRST_CHUNKS,
  queryTerms,
  relevance,
  selectChunks,
  type SelectableSource,
} from './select-chunks.ts';

/** A chunk of exactly `tokens` estimated tokens (4 characters each), led by `words`. */
function chunk(sourceId: number, n: number, tokens: number, words = '') {
  const text = `${words} `.padEnd(tokens * 4, '.');
  return { id: `source-${sourceId}#chunk-${n}`, text };
}

function source(sourceId: number, chunks: ReturnType<typeof chunk>[]): SelectableSource {
  return { sourceId, chunks };
}

const ids = (sources: readonly SelectableSource[]) => sources.map((s) => s.chunks.map((c) => c.id));

describe('fairShares', () => {
  it('gives small sources all they need and splits the rest equally', () => {
    expect(fairShares([100, 1_000, 5_000], 1_000)).toEqual([100, 450, 450]);
    expect(fairShares([300, 300], 1_000)).toEqual([300, 300]);
    expect(fairShares([800, 800, 800], 900)).toEqual([300, 300, 300]);
  });
});

describe('queryTerms and relevance', () => {
  it('keeps content words, folds plurals, drops stopwords', () => {
    expect(queryTerms('How rate limiters work, and what breaks when the store is slow')).toEqual([
      'rate',
      'limiter',
      'break',
      'store',
      'slow',
    ]);
  });

  it('ranks by distinct terms matched, then density', () => {
    const terms = ['token', 'bucket'];
    expect(relevance('A token bucket refills tokens.', terms)).toEqual({
      matched: 2,
      density: 3 / 4,
    });
    expect(relevance('Nothing here at all.', terms).matched).toBe(0);
  });
});

describe('selectChunks', () => {
  it('keeps everything under the budget', () => {
    const sources = [source(1, [chunk(1, 1, 100), chunk(1, 2, 100)])];
    const selection = selectChunks(sources, { budgetTokens: 1_000, query: 'x' });
    expect(selection).toEqual({ sources, omitted: [], sourceTokens: 200, keptTokens: 200 });
  });

  it('keeps each source’s first chunks, fills its share by relevance, in original order', () => {
    const big = source(1, [
      chunk(1, 1, 100, 'intro'),
      chunk(1, 2, 100, 'definitions'),
      chunk(1, 3, 100, 'unrelated history'),
      chunk(1, 4, 100, 'token bucket refill'),
      chunk(1, 5, 100, 'office party'),
      chunk(1, 6, 100, 'token bucket token bucket'),
      chunk(1, 7, 100, 'bucket'),
    ]);
    const small = source(2, [chunk(2, 1, 100, 'readme'), chunk(2, 2, 50, 'config')]);
    const selection = selectChunks([big, small], { budgetTokens: 550, query: 'Token buckets' });

    // small needs 150 of its 275 share; big gets the remaining 400: 2 first chunks + 2 best.
    expect(ids(selection.sources)).toEqual([
      ['source-1#chunk-1', 'source-1#chunk-2', 'source-1#chunk-4', 'source-1#chunk-6'],
      ['source-2#chunk-1', 'source-2#chunk-2'],
    ]);
    expect(selection.omitted).toEqual([
      { id: 'source-1#chunk-3', sourceId: 1, tokens: 100 },
      { id: 'source-1#chunk-5', sourceId: 1, tokens: 100 },
      { id: 'source-1#chunk-7', sourceId: 1, tokens: 100 },
    ]);
    expect(selection).toMatchObject({ sourceTokens: 850, keptTokens: 550 });
  });

  it('keeps the first chunks even past a tiny share, and never drops a source', () => {
    const sources = [1, 2, 3].map((id) =>
      source(id, [chunk(id, 1, 200), chunk(id, 2, 200), chunk(id, 3, 200, 'token')]),
    );
    const selection = selectChunks(sources, { budgetTokens: 300, query: 'token' });
    expect(ids(selection.sources)).toEqual(
      [1, 2, 3].map((id) =>
        Array.from({ length: KEEP_FIRST_CHUNKS }, (_, i) => `source-${id}#chunk-${i + 1}`),
      ),
    );
  });

  it('is deterministic and breaks relevance ties by original order', () => {
    const sources = [
      source(1, [
        chunk(1, 1, 100),
        chunk(1, 2, 100),
        chunk(1, 3, 100, 'same'),
        chunk(1, 4, 100, 'same'),
      ]),
    ];
    const a = selectChunks(sources, { budgetTokens: 300, query: 'same' });
    const b = selectChunks(sources, { budgetTokens: 300, query: 'same' });
    expect(a).toEqual(b);
    expect(ids(a.sources)[0]).toContain('source-1#chunk-3');
  });

  it('estimates tokens at 4 characters each, rounding up', () => {
    expect(estimateTokens('abcde')).toBe(2);
  });
});
