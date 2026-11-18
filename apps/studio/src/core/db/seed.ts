import type { Db } from './client.ts';
import { channels, series } from './schema.ts';

export const DEFAULT_CHANNEL = { name: 'Explainer Studio' } as const;

export const DEFAULT_SERIES = [
  { name: 'System Design', tag: 'system-design', accentColour: '#4F8CFF' },
  { name: 'AI', tag: 'ai', accentColour: '#B07CFF' },
] as const;

/**
 * Inserts the default channel and series into an empty database. Does nothing once any channel
 * exists, so later edits (renames, colours) are never overwritten. Returns whether it seeded.
 */
export function seedDefaults(db: Db): boolean {
  return db.transaction((tx) => {
    if (tx.select({ id: channels.id }).from(channels).limit(1).get()) return false;
    const channel = tx.insert(channels).values(DEFAULT_CHANNEL).returning().get();
    tx.insert(series)
      .values(DEFAULT_SERIES.map((s) => ({ ...s, channelId: channel.id })))
      .run();
    return true;
  });
}
