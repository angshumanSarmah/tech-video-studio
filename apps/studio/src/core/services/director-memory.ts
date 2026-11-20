import type { DirectorMemory, UsageKind } from '@explainer-studio/shared';
import { countDistinct, desc, eq, inArray, max, ne } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { activeStyleRules } from './style-rules.ts';
import { exports, runs, topics, usageHistory } from '../db/schema.ts';

/** Exported videos whose usage the Director avoids repeating. */
export const RECENT_VIDEOS = 5;

/** Earlier topics listed to the Director, newest first. */
export const PAST_TOPICS_LIMIT = 20;

/**
 * The Director's memory context (P1C.5; P1C.10 writes what it reads): its active style rules,
 * what the last `RECENT_VIDEOS` exported videos used, and earlier exported topics. Read-only;
 * `runId`'s own exports and topic are left out. Lists are sorted by code unit, so the prompt is
 * the same for the same history.
 */
export function directorMemory(db: Executor, runId: number): DirectorMemory {
  const recentRunIds = exportedRuns(db, runId, RECENT_VIDEOS).map((r) => r.runId);
  const usage = usageValues(db, recentRunIds);
  return {
    styleRules: activeStyleRules(db, 'director'),
    recent: {
      videos: recentRunIds.length,
      devices: usage('device'),
      layouts: usage('layout'),
      patterns: usage('pattern'),
      combos: usage('device_layout'),
    },
    pastTopics: pastTopics(db, runId),
  };
}

/** Runs with an export other than `runId`, newest export first. */
function exportedRuns(db: Executor, runId: number, limit: number) {
  const lastExport = max(exports.id);
  return db
    .select({ runId: exports.runId, topicId: runs.topicId, lastExport })
    .from(exports)
    .innerJoin(runs, eq(runs.id, exports.runId))
    .where(ne(exports.runId, runId))
    .groupBy(exports.runId)
    .orderBy(desc(lastExport))
    .limit(limit)
    .all();
}

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function usageValues(db: Executor, runIds: readonly number[]): (kind: UsageKind) => string[] {
  const rows =
    runIds.length === 0
      ? []
      : db
          .select({ kind: usageHistory.kind, value: usageHistory.value })
          .from(usageHistory)
          .where(inArray(usageHistory.runId, [...runIds]))
          .all();
  return (kind) =>
    [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.value))].sort(byCodeUnits);
}

function pastTopics(db: Executor, runId: number): DirectorMemory['pastTopics'] {
  const current = db.select({ topicId: runs.topicId }).from(runs).where(eq(runs.id, runId)).get();
  const seen = new Set<number>(current ? [current.topicId] : []);
  const ordered = exportedRuns(db, runId, Number.MAX_SAFE_INTEGER).filter((r) => {
    if (seen.has(r.topicId)) return false;
    seen.add(r.topicId);
    return true;
  });
  const ids = ordered.slice(0, PAST_TOPICS_LIMIT).map((r) => r.topicId);
  if (ids.length === 0) return [];
  const rows = db.select().from(topics).where(inArray(topics.id, ids)).all();
  const byId = new Map(rows.map((t) => [t.id, t]));
  return ids.flatMap((id) => {
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
