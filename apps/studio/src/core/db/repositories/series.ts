import { eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { series } from '../schema.ts';

export type Series = typeof series.$inferSelect;

export function listSeries(db: Executor): Series[] {
  return db.select().from(series).orderBy(series.id).all();
}

export function getSeries(db: Executor, id: number): Series | undefined {
  return db.select().from(series).where(eq(series.id, id)).get();
}
