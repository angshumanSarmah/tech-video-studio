import { describe, expect, it } from 'vitest';
import { TOPIC_SIMILARITY_WARN, topicMatchMessage, topicSimilarity } from './topic-similarity.ts';

const similar = (a: string, b: string) => topicSimilarity(a, b) >= TOPIC_SIMILARITY_WARN;

describe('topicSimilarity', () => {
  it.each([
    ['Rate limiter', 'Rate limiting'],
    ['Rate limiter', 'rate limiters'],
    ['Consistent hashing', 'Consistent hashing in key-value stores'],
    ['Tokenizer', 'Tokenization'],
    ['How a rate limiter works', 'Rate limiter'],
  ])('warns for "%s" and "%s"', (a, b) => {
    expect(similar(a, b)).toBe(true);
    expect(topicSimilarity(a, b)).toBe(topicSimilarity(b, a));
  });

  it.each([
    ['Cache eviction', 'Cache stampede'],
    ['Load balancer', 'Rate limiter'],
    ['Vector databases', 'Write-ahead log'],
  ])('does not warn for "%s" and "%s"', (a, b) => {
    expect(similar(a, b)).toBe(false);
  });

  it('is 1 for the same title and 0 when a title has no content words', () => {
    expect(topicSimilarity('Bloom filters', 'bloom filter')).toBe(1);
    expect(topicSimilarity('How it works', 'Bloom filters')).toBe(0);
  });
});

describe('topicMatchMessage', () => {
  it('names the run, when it exported and its angle', () => {
    expect(
      topicMatchMessage({
        topicId: 3,
        title: 'Rate limiter',
        angle: 'fail open or closed',
        runId: 7,
        exportedAt: '2026-11-20T10:00:00.000Z',
        score: 1,
      }),
    ).toBe(
      'Close to an earlier topic: "Rate limiter" (run 7, exported 2026-11-20, angle "fail open or closed"; similarity 1.00).',
    );
  });
});
