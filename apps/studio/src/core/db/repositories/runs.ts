import {
  RunSettingsSchema,
  type RunSettings,
  type RunSettingsInput,
  type RunStatus,
} from '@explainer-studio/shared';
import { and, desc, eq, getTableColumns, isNotNull, notInArray, sql } from 'drizzle-orm';
import type { Db, Executor } from '../client.ts';
import { exports, jobs, runSources, runs, sources } from '../schema.ts';

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

/** Statuses a run never leaves. */
export const TERMINAL_RUN_STATUSES = ['done', 'failed', 'cancelled'] as const satisfies RunStatus[];

/**
 * Sets the status of a run that has not finished yet. Returns the updated run, or undefined when
 * the run is unknown or already terminal (nothing changed).
 */
export function setActiveRunStatus(db: Executor, id: number, status: RunStatus): Run | undefined {
  const row = db
    .update(runs)
    .set({ status })
    .where(and(eq(runs.id, id), notInArray(runs.status, TERMINAL_RUN_STATUSES)))
    .returning()
    .get();
  return row && toRun(row);
}

/** A run plus the error of its newest failed job (why it failed), or null. */
export type RunSummary = Run & { readonly lastError: string | null };

/**
 * Error of the run's newest failed job, as a correlated subquery so a run list stays one query.
 * Built with the query builder, which qualifies columns in `where`; inside a raw `sql` template,
 * `jobs.run_id = runs.id` would render unqualified and compare the job with itself.
 */
function lastErrorOf(db: Executor) {
  const newestFailed = db
    .select({ error: jobs.error })
    .from(jobs)
    .where(and(eq(jobs.runId, runs.id), eq(jobs.status, 'failed')))
    .orderBy(desc(jobs.id))
    .limit(1);
  return sql<string | null>`(${newestFailed})`;
}

function selectSummaries(db: Executor) {
  return db.select({ ...getTableColumns(runs), lastError: lastErrorOf(db) }).from(runs);
}

function toRunSummary({ lastError, ...row }: RunRow & { lastError: string | null }): RunSummary {
  return { ...toRun(row), lastError };
}

export function getRunSummary(db: Executor, id: number): RunSummary | undefined {
  const row = selectSummaries(db).where(eq(runs.id, id)).get();
  return row && toRunSummary(row);
}

/** Newest first. */
export function listRuns(db: Executor): RunSummary[] {
  return selectSummaries(db).orderBy(desc(runs.id)).all().map(toRunSummary);
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
