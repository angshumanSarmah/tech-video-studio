import { desc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { topics } from '../schema.ts';

export type Topic = typeof topics.$inferSelect;

export interface NewTopic {
  readonly title: string;
  readonly notes?: string | undefined;
}

export function createTopic(db: Executor, input: NewTopic): Topic {
  return db
    .insert(topics)
    .values({ title: input.title, notes: input.notes ?? null })
    .returning()
    .get();
}

export function getTopic(db: Executor, id: number): Topic | undefined {
  return db.select().from(topics).where(eq(topics.id, id)).get();
}

/** Newest first. */
export function listTopics(db: Executor): Topic[] {
  return db.select().from(topics).orderBy(desc(topics.id)).all();
}
