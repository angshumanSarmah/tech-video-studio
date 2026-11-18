import {
  RunSettingsSchema,
  type RunSettings,
  type RunSettingsInput,
} from '@explainer-studio/shared';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Db, Executor } from '../client.ts';
import { exports, runSources, runs, sources } from '../schema.ts';

type RunRow = typeof runs.$inferSelect;

export type Run = Omit<RunRow, 'settings'> & { readonly settings: RunSettings };

export interface NewRun {
  readonly topicId: number;
  readonly seriesId: number;
  readonly settings?: RunSettingsInput;
}

/** Settings JSON can be hand-edited on disk, so it is validated on read as well as write. */
function toRun(row: RunRow): Run {
  return { ...row, settings: RunSettingsSchema.parse(row.settings) };
}

export function createRun(db: Executor, input: NewRun): Run {
  const settings = RunSettingsSchema.parse(input.settings ?? {});
  const row = db
    .insert(runs)
    .values({ topicId: input.topicId, seriesId: input.seriesId, settings })
    .returning()
    .get();
  return toRun(row);
}

export function getRun(db: Executor, id: number): Run | undefined {
  const row = db.select().from(runs).where(eq(runs.id, id)).get();
  return row && toRun(row);
}

/** Newest first. */
export function listRuns(db: Executor): Run[] {
  return db.select().from(runs).orderBy(desc(runs.id)).all().map(toRun);
}

/** An exported run anchors variety memory (usage history), so it can never be deleted. */
export class RunHasExportsError extends Error {
  constructor(readonly runId: number) {
    super(`Run ${runId} has exports and cannot be deleted`);
    this.name = 'RunHasExportsError';
  }
}

/**
 * Deletes a run that never exported; its steps, gates, specs and usage history cascade. Returns
 * false for an unknown id. The `exports` FK is `restrict`, so the DB enforces this too.
 */
export function deleteRun(db: Db, id: number): boolean {
  return db.transaction((tx) => {
    const exported = tx.select({ id: exports.id }).from(exports).where(eq(exports.runId, id)).get();
    if (exported) throw new RunHasExportsError(id);
    return tx.delete(runs).where(eq(runs.id, id)).run().changes > 0;
  });
}

export interface RunSourceVersion {
  readonly sourceId: number;
  readonly contentHash: string;
}

/**
 * Pins the current version of every extracted source of the run's topic to the run. Sources
 * already pinned keep their original hash, so a later re-fetch never changes what the run used.
 */
export function recordRunSources(db: Db, runId: number): RunSourceVersion[] {
  return db.transaction((tx) => {
    const run = tx.select({ topicId: runs.topicId }).from(runs).where(eq(runs.id, runId)).get();
    if (!run) throw new Error(`Run ${runId} not found`);
    const current = tx
      .select({ sourceId: sources.id, contentHash: sources.contentHash })
      .from(sources)
      .where(and(eq(sources.topicId, run.topicId), isNotNull(sources.contentHash)))
      .all()
      .filter((s): s is RunSourceVersion => s.contentHash !== null);
    if (current.length > 0) {
      tx.insert(runSources)
        .values(current.map((s) => ({ runId, ...s })))
        .onConflictDoNothing()
        .run();
    }
    return listRunSources(tx, runId);
  });
}

export function listRunSources(db: Executor, runId: number): RunSourceVersion[] {
  return db
    .select({ sourceId: runSources.sourceId, contentHash: runSources.contentHash })
    .from(runSources)
    .where(eq(runSources.runId, runId))
    .orderBy(runSources.sourceId)
    .all();
}
