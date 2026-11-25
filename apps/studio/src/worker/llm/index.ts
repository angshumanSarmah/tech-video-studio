import type { LlmSettings } from '@explainer-studio/shared';
import type { AppConfig } from '#core/config.ts';
import { dryRunTransport, loadDryRunFixtures } from './dry-run.ts';
import { httpTransport } from './transport.ts';
import type { LlmTransport } from './types.ts';

export * from './client.ts';
export { callCostUsd, isOffPeak } from './cost.ts';
export * from './dry-run.ts';
export { normalizeJsonText, normalizeValue, type FieldAlias } from './normalize.ts';
export {
  LlmBodyCutOffError,
  LlmConfigError,
  LlmRequestError,
  LlmTimeoutError,
} from './transport.ts';
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

/**
 * The worker's transport: recorded answers when `LLM_DRY_RUN_DIR` is set (P1C.9's dry run), the
 * HTTP API otherwise. Either way calls go through the one LLM client, so they are validated,
 * logged and costed the same.
 */
export function workerTransport(config: Pick<AppConfig, 'llm' | 'llmDryRunDir'>): {
  readonly transport: LlmTransport;
  readonly dryRun: boolean;
} {
  if (config.llmDryRunDir === null) {
    return { transport: createLlmTransport(config.llm), dryRun: false };
  }
  return { transport: dryRunTransport(loadDryRunFixtures(config.llmDryRunDir)), dryRun: true };
}
