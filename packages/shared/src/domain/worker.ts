import { z } from 'zod';

/** Which process holds the worker lock (P1C.9b): the `pnpm dev` / `start` worker, or a CLI. */
export const WORKER_KINDS = ['worker', 'cli'] as const;
export const WorkerKindSchema = z.enum(WORKER_KINDS);
export type WorkerKind = z.infer<typeof WorkerKindSchema>;

/** Where a worker's LLM answers come from: the API, or recorded answers (`LLM_DRY_RUN_DIR`). */
export const LLM_MODES = ['live', 'dry_run'] as const;
export const LlmModeSchema = z.enum(LLM_MODES);
export type LlmMode = z.infer<typeof LlmModeSchema>;
