import { and, eq } from 'drizzle-orm';
import type { Db, Executor } from '../client.ts';
import { exports } from '../schema.ts';
import { runCostUsd } from './llm-calls.ts';

export type ExportRow = typeof exports.$inferSelect;

export interface NewExport {
  readonly runId: number;
  /** Relative to the data dir. */
  readonly mp4Path: string;
  /** Relative to the data dir. */
  readonly srtPath: string;
  readonly durationMs: number;
  readonly title: string | null;
}

/**
 * Records a finished export (its MP4 and SRT already written). One row per run and video path:
 * a rerun of the same final job (delivery is at-least-once) refreshes that row instead of adding
 * another. Cost is the run's LLM spend at this moment. The row makes the run undeletable
 * (`deleteRun`, and the `restrict` FK), so call this only once both files exist.
 */
export function recordExport(db: Db, input: NewExport): ExportRow {
  return db.transaction((tx) => {
    const values = { ...input, costUsd: runCostUsd(tx, input.runId) };
    const existing = tx
      .select({ id: exports.id })
      .from(exports)
      .where(and(eq(exports.runId, input.runId), eq(exports.mp4Path, input.mp4Path)))
      .get();
    if (existing) {
      return tx.update(exports).set(values).where(eq(exports.id, existing.id)).returning().get();
    }
    return tx.insert(exports).values(values).returning().get();
  });
}

export function listRunExports(db: Executor, runId: number): ExportRow[] {
  return db.select().from(exports).where(eq(exports.runId, runId)).orderBy(exports.id).all();
}
