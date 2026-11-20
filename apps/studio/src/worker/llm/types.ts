import type { ModelRole } from '@explainer-studio/shared';

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** An assembled prompt (`buildPrompt`) and the versions it was built from. */
export interface BuiltPrompt {
  /** Static content first (system message), the run's input last, so provider caching hits. */
  readonly messages: readonly ChatMessage[];
  readonly versions: {
    /** e.g. `preamble@v1`; null for a prompt without the shared preamble. */
    readonly preamble: string | null;
    /** e.g. `director@v1`. */
    readonly role: string;
  };
}

/** Token counts from one response. `out` includes `reasoning` (both are billed as output). */
export interface TokenUsage {
  readonly inCached: number;
  readonly inUncached: number;
  readonly out: number;
  readonly reasoning: number;
}

export interface TransportRequest {
  readonly role: ModelRole;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly signal?: AbortSignal;
}

export interface TransportResponse {
  /** The answer. Null when the model returned none (e.g. it hit its length limit). */
  readonly content: string | null;
  /** Reasoning ("thinking") text, when the model returns it. Never parsed as the answer. */
  readonly reasoningContent: string | null;
  readonly servedModel: string | null;
  readonly finishReason: string | null;
  readonly usage: TokenUsage;
  /** The usage object as the API sent it, kept in the response file. */
  readonly rawUsage: unknown;
}

/** Sends one chat completion. HTTP (`httpTransport`) or recorded fixtures (`dryRunTransport`). */
export interface LlmTransport {
  send(request: TransportRequest): Promise<TransportResponse>;
}

/** A validation problem in model output, at a JSON path (`$.script[0].headline`). */
export interface OutputIssue {
  readonly path: string;
  readonly message: string;
  readonly code?: string;
}
