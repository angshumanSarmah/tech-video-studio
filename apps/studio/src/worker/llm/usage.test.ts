import { describe, expect, it } from 'vitest';
import { parseUsage, ZERO_USAGE } from './usage.ts';

describe('parseUsage', () => {
  it("reads DeepSeek's cache hit and miss counts and reasoning tokens", () => {
    expect(
      parseUsage({
        prompt_tokens: 1_000,
        completion_tokens: 400,
        prompt_cache_hit_tokens: 700,
        prompt_cache_miss_tokens: 300,
        completion_tokens_details: { reasoning_tokens: 250 },
      }),
    ).toEqual({ inCached: 700, inUncached: 300, out: 400, reasoning: 250 });
  });

  it("falls back to OpenAI's cached_tokens and derives the uncached rest", () => {
    expect(
      parseUsage({
        prompt_tokens: 1_000,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 600 },
      }),
    ).toEqual({ inCached: 600, inUncached: 400, out: 50, reasoning: 0 });
  });

  it('treats input as uncached when nothing reports a cache hit', () => {
    expect(parseUsage({ prompt_tokens: 90, completion_tokens: 10 })).toEqual({
      inCached: 0,
      inUncached: 90,
      out: 10,
      reasoning: 0,
    });
  });

  it('gives zeros without usage', () => {
    expect(parseUsage(null)).toEqual(ZERO_USAGE);
  });
});
