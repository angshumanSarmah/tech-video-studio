import type { DirectorMemory } from '@explainer-studio/shared';
import { countDistinct, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { getRun } from '../db/repositories/runs.ts';
import { activeStyleRules } from './style-rules.ts';
import { similarTopics } from './topic-history.ts';
import {
  exportedVideos,
  recentStructures,
  videosUsage,
  type ExportedVideo,
} from './usage-history.ts';
import { exports, runs, topics } from '../db/schema.ts';

/** Exported videos whose usage the Director and the Curator avoid repeating. */
export const RECENT_VIDEOS = 5;

/** Earlier topics listed to the Director, newest first. */
export const PAST_TOPICS_LIMIT = 20;

/**
 * The Director's memory context (P1C.5; P1C.10 records what it reads): its active style rules,
 * what the last `RECENT_VIDEOS` exported videos used (a multi-part video counts once) with each
 * one's structure, earlier exported topics and the topics close to this run's. The run's own
 * video (itself, its parent and sibling parts) and topic are left out. Lists are sorted by code
 * unit, so the prompt is the same for the same history. Read-only.
 */
export function directorMemory(db: Executor, runId: number): DirectorMemory {
  const videos = exportedVideos(db, { excludeVideoOf: runId });
  return {
    styleRules: activeStyleRules(db, 'director'),
    recent: recentOf(db, videos),
    pastTopics: pastTopics(db, runId, videos),
    similarTopics: similarTopics(db, runId),
  };
}

export type RecentUsage = Required<DirectorMemory['recent']>;

/**
 * What the last `RECENT_VIDEOS` exported videos used, without the run's own video: the
 * Director's `recent` memory, and what the Curator's variety checks read.
 */
export function recentUsage(db: Executor, runId: number): RecentUsage {
  return recentOf(db, exportedVideos(db, { excludeVideoOf: runId }));
}

function recentOf(db: Executor, videos: readonly ExportedVideo[]): RecentUsage {
  const recent = videos.slice(0, RECENT_VIDEOS);
  const usage = videosUsage(db, recent);
  return {
    videos: recent.length,
    devices: usage.values('device'),
    layouts: usage.values('layout'),
    patterns: usage.values('pattern'),
    combos: usage.values('device_layout'),
    structures: recentStructures(recent, usage),
  };
}

function pastTopics(
  db: Executor,
  runId: number,
  videos: readonly ExportedVideo[],
): DirectorMemory['pastTopics'] {
  const current = getRun(db, runId);
  const seen = new Set<number>(current ? [current.topicId] : []);
  const ids: number[] = [];
  for (const topicId of videos.flatMap((v) => v.topicIds)) {
    if (seen.has(topicId)) continue;
    seen.add(topicId);
    ids.push(topicId);
  }
  const listed = ids.slice(0, PAST_TOPICS_LIMIT);
  if (listed.length === 0) return [];
  const rows = db.select().from(topics).where(inArray(topics.id, listed)).all();
  const byId = new Map(rows.map((t) => [t.id, t]));
  return listed.flatMap((id) => {
    const topic = byId.get(id);
    return topic ? [{ title: topic.title, notes: topic.notes }] : [];
  });
}

/** This video's number in its series: the series' exported videos so far, plus one. */
export function nextSeriesNumber(db: Executor, seriesId: number): number {
  const row = db
    .select({ videos: countDistinct(exports.runId) })
    .from(exports)
    .innerJoin(runs, eq(runs.id, exports.runId))
    .where(eq(runs.seriesId, seriesId))
    .get();
  return (row?.videos ?? 0) + 1;
}
