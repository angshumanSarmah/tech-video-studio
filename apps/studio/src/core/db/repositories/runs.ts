import {
  RunSettingsSchema,
  type RunSettings,
  type RunSettingsInput,
} from '@explainer-studio/shared';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { runSources, runs, sources } from '../schema.ts';

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

export function createRun(db: Db, input: NewRun): Run {
  const settings = RunSettingsSchema.parse(input.settings ?? {});
  const row = db
    .insert(runs)
    .values({ topicId: input.topicId, seriesId: input.seriesId, settings })
    .returning()
    .get();
  return toRun(row);
}

export function getRun(db: Db, id: number): Run | undefined {
  const row = db.select().from(runs).where(eq(runs.id, id)).get();
  return row && toRun(row);
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

export function listRunSources(db: Pick<Db, 'select'>, runId: number): RunSourceVersion[] {
  return db
    .select({ sourceId: runSources.sourceId, contentHash: runSources.contentHash })
    .from(runSources)
    .where(eq(runSources.runId, runId))
    .orderBy(runSources.sourceId)
    .all();
}
