import { z } from 'zod';
import type { TokenUsage } from './types.ts';

const Count = z.number().int().nonnegative().optional();

/**
 * The usage object of an OpenAI-compatible response. DeepSeek reports cache hits and misses
 * directly; OpenAI reports cached tokens inside `prompt_tokens_details`. Both count reasoning
 * tokens inside `completion_tokens`.
 */
export const RawUsageSchema = z.looseObject({
  prompt_tokens: Count,
  completion_tokens: Count,
  prompt_cache_hit_tokens: Count,
  prompt_cache_miss_tokens: Count,
  prompt_tokens_details: z.looseObject({ cached_tokens: Count }).nullish(),
  completion_tokens_details: z.looseObject({ reasoning_tokens: Count }).nullish(),
});

export type RawUsage = z.infer<typeof RawUsageSchema>;

export const ZERO_USAGE: TokenUsage = { inCached: 0, inUncached: 0, out: 0, reasoning: 0 };

/** Cached vs uncached input, output (reasoning included) and the reasoning share. */
export function parseUsage(raw: RawUsage | null | undefined): TokenUsage {
  if (!raw) return ZERO_USAGE;
  const inCached = raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? 0;
  const inUncached =
    raw.prompt_cache_miss_tokens ?? Math.max(0, (raw.prompt_tokens ?? 0) - inCached);
  return {
    inCached,
    inUncached,
    out: raw.completion_tokens ?? 0,
    reasoning: raw.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}
