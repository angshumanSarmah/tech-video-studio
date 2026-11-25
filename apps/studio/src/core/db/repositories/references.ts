import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { referenceVideos } from '../schema.ts';

/** Reference video rows (P1C.11). The record itself lives in its file (`record_path`). */

export type ReferenceRow = typeof referenceVideos.$inferSelect;
export type NewReferenceRow = typeof referenceVideos.$inferInsert;

export function insertReference(db: Executor, row: NewReferenceRow): ReferenceRow {
  return db.insert(referenceVideos).values(row).returning().get();
}

export function getReference(db: Executor, id: number): ReferenceRow | undefined {
  return db.select().from(referenceVideos).where(eq(referenceVideos.id, id)).get();
}

export function getReferenceBySlug(db: Executor, slug: string): ReferenceRow | undefined {
  return db.select().from(referenceVideos).where(eq(referenceVideos.slug, slug)).get();
}

/** Every reference, oldest first. */
export function listReferenceRows(db: Executor): ReferenceRow[] {
  return db.select().from(referenceVideos).orderBy(asc(referenceVideos.id)).all();
}

export function updateReference(
  db: Executor,
  id: number,
  patch: Partial<Omit<NewReferenceRow, 'id' | 'createdAt'>>,
): ReferenceRow {
  return db
    .update(referenceVideos)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(referenceVideos.id, id))
    .returning()
    .get();
}
