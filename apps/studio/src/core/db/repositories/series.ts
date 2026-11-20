import { eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { channels, series } from '../schema.ts';

export type Series = typeof series.$inferSelect;

export function listSeries(db: Executor): Series[] {
  return db.select().from(series).orderBy(series.id).all();
}

export function getSeries(db: Executor, id: number): Series | undefined {
  return db.select().from(series).where(eq(series.id, id)).get();
}

/** The handle of the channel a series belongs to (null when the channel has none). */
export function seriesChannelHandle(db: Executor, seriesId: number): string | null {
  const row = db
    .select({ handle: channels.handle })
    .from(series)
    .innerJoin(channels, eq(channels.id, series.channelId))
    .where(eq(series.id, seriesId))
    .get();
  return row?.handle ?? null;
}
