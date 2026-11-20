import type { SpecAuthor } from '@explainer-studio/shared';
import { desc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { specVersions } from '../schema.ts';

export type SpecVersion = typeof specVersions.$inferSelect;

export interface NewSpecVersion {
  readonly runId: number;
  readonly version: number;
  /** Relative to the data dir (`specVersionPath`); the caller writes the file. */
  readonly jsonPath: string;
  readonly createdBy: SpecAuthor;
  readonly sourceLabel?: string | null;
  readonly note?: string | null;
}

export function createSpecVersion(db: Executor, input: NewSpecVersion): SpecVersion {
  return db
    .insert(specVersions)
    .values({ ...input, sourceLabel: input.sourceLabel ?? null, note: input.note ?? null })
    .returning()
    .get();
}

/** The run's newest spec version, or undefined before its first. */
export function getLatestSpecVersion(db: Executor, runId: number): SpecVersion | undefined {
  return db
    .select()
    .from(specVersions)
    .where(eq(specVersions.runId, runId))
    .orderBy(desc(specVersions.version))
    .limit(1)
    .get();
}

export function getSpecVersion(db: Executor, id: number): SpecVersion | undefined {
  return db.select().from(specVersions).where(eq(specVersions.id, id)).get();
}
