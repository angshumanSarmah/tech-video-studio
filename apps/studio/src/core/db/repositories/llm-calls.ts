import type { ModelRole, NormalizerFix } from '@explainer-studio/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { llmCalls } from '../schema.ts';

export type LlmCallRow = typeof llmCalls.$inferSelect;

export interface NewLlmCall {
  readonly runId: number | null;
  readonly stepId?: number | null;
  readonly role: ModelRole;
  /** The role prompt, e.g. `director@v1`. */
  readonly promptVersion: string;
  /** The shared preamble, e.g. `preamble@v1`; null for a prompt without one. */
  readonly preambleVersion: string | null;
  readonly attempt: number;
  readonly model: string;
  readonly servedModel: string | null;
  readonly tokensInCached: number;
  readonly tokensInUncached: number;
  readonly tokensOut: number;
  readonly tokensReasoning: number;
  readonly costUsd: number;
  /** Relative to the data dir (`llmCallPaths`); the caller writes the files. */
  readonly promptPath: string;
  readonly responsePath: string | null;
  readonly durationMs: number;
  readonly error: string | null;
  readonly normalizerFixes: readonly NormalizerFix[];
}

export function insertLlmCall(db: Executor, input: NewLlmCall): LlmCallRow {
  return db
    .insert(llmCalls)
    .values({
      ...input,
      stepId: input.stepId ?? null,
      normalizerFixes: [...input.normalizerFixes],
    })
    .returning()
    .get();
}

/** A run's calls in the order they were made. */
export function listRunLlmCalls(db: Executor, runId: number): LlmCallRow[] {
  return db
    .select()
    .from(llmCalls)
    .where(eq(llmCalls.runId, runId))
    .orderBy(asc(llmCalls.id))
    .all();
}

/** What the run's LLM calls cost so far, in USD. */
export function runCostUsd(db: Executor, runId: number): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` })
    .from(llmCalls)
    .where(eq(llmCalls.runId, runId))
    .get();
  return row?.total ?? 0;
}
