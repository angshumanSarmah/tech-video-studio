import { eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { channels, runs, series, topics } from '../schema.ts';

/** What a render needs about a run besides its spec: names for the HUD and the export file. */
export interface RunRenderContext {
  readonly runId: number;
  readonly topicTitle: string;
  readonly series: { readonly label: string; readonly accentColour: string };
  /** Null hides it in the top bar. */
  readonly channelHandle: string | null;
}

export function getRunRenderContext(db: Executor, runId: number): RunRenderContext | undefined {
  const row = db
    .select({
      runId: runs.id,
      topicTitle: topics.title,
      label: series.label,
      accentColour: series.accentColour,
      channelHandle: channels.handle,
    })
    .from(runs)
    .innerJoin(topics, eq(topics.id, runs.topicId))
    .innerJoin(series, eq(series.id, runs.seriesId))
    .innerJoin(channels, eq(channels.id, series.channelId))
    .where(eq(runs.id, runId))
    .get();
  if (!row) return undefined;
  const { label, accentColour, ...rest } = row;
  return { ...rest, series: { label, accentColour } };
}
