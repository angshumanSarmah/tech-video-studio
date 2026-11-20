import type { LlmSettings } from '@explainer-studio/shared';
import { httpTransport } from './transport.ts';
import type { LlmTransport } from './types.ts';

export * from './client.ts';
export { callCostUsd, isOffPeak } from './cost.ts';
export * from './dry-run.ts';
export { normalizeJsonText, normalizeValue, type FieldAlias } from './normalize.ts';
export { LlmConfigError, LlmRequestError, LlmTimeoutError } from './transport.ts';
export type * from './types.ts';

/** The real transport for the configured endpoint (`AppConfig.llm`: key already resolved). */
export function createLlmTransport(
  llm: LlmSettings,
  options: { fetch?: typeof fetch } = {},
): LlmTransport {
  return httpTransport({
    baseUrl: llm.baseUrl,
    apiKey: llm.apiKey,
    timeoutMs: llm.requestTimeoutSec * 1_000,
    fetch: options.fetch,
  });
}
