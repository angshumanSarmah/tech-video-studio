import {
  USAGE_KINDS,
  type RecentStructure,
  type UsageCount,
  type UsageKind,
  type UsageSummary,
} from '@explainer-studio/shared';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { getRun } from '../db/repositories/runs.ts';
import { usageOfRuns, type UsageValue } from '../db/repositories/usage-history.ts';
import { exports, runs, usageHistory } from '../db/schema.ts';

/**
 * The usage history read by video (P1C.10). A video is one run, or a multi-part video's parts
 * together (`videoKey`: the parent's id), so a three-part video takes one place among the
 * recent ones. Only runs that recorded usage at their export are videos (a scratch `studio
 * render` run records none). Newest first: by the newest export of any of its runs.
 */

export interface ExportedVideo {
  /** The parent run of a multi-part video, else the run itself. */
  readonly key: number;
  /** Its runs that exported (each part), ascending. */
  readonly runIds: readonly number[];
  /** Its topics (a multi-part video's parts share one). */
  readonly topicIds: readonly number[];
  /** The run of its newest export, with that export's title and time. */
  readonly newestRunId: number;
  readonly title: string | null;
  readonly exportedAt: Date;
}

/** The video a run belongs to: its parent's id for a part, else its own. */
export function videoKey(run: { readonly id: number; readonly parentRunId: number | null }) {
  return run.parentRunId ?? run.id;
}

/** Exported videos, newest first, without `excludeVideoOf`'s own video (the run, its parts). */
export function exportedVideos(
  db: Executor,
  options: { readonly excludeVideoOf?: number } = {},
): ExportedVideo[] {
  const excluded = excludedKey(db, options.excludeVideoOf);
  const withUsage = db.select({ runId: usageHistory.runId }).from(usageHistory);
  const rows = db
    .select({
      exportId: exports.id,
      exportedAt: exports.createdAt,
      title: exports.title,
      runId: runs.id,
      parentRunId: runs.parentRunId,
      topicId: runs.topicId,
    })
    .from(exports)
    .innerJoin(runs, eq(runs.id, exports.runId))
    .where(inArray(exports.runId, withUsage))
    .orderBy(desc(exports.id))
    .all();
  const videos = new Map<number, ExportedVideo>();
  for (const row of rows) {
    const key = videoKey({ id: row.runId, parentRunId: row.parentRunId });
    if (key === excluded) continue;
    const video = videos.get(key);
    if (!video) {
      videos.set(key, {
        key,
        runIds: [row.runId],
        topicIds: [row.topicId],
        newestRunId: row.runId,
        title: row.title,
        exportedAt: row.exportedAt,
      });
      continue;
    }
    videos.set(key, {
      ...video,
      runIds: union(video.runIds, row.runId).sort((a, b) => a - b),
      topicIds: union(video.topicIds, row.topicId),
    });
  }
  return [...videos.values()];
}

function excludedKey(db: Executor, runId: number | undefined): number | undefined {
  if (runId === undefined) return undefined;
  const run = getRun(db, runId);
  return run ? videoKey(run) : runId;
}

const union = (list: readonly number[], value: number): number[] =>
  list.includes(value) ? [...list] : [...list, value];

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The usage of some videos, read once: distinct values per kind, overall or per video. */
export interface VideosUsage {
  /** Every value of a kind across the videos, distinct, sorted by code unit. */
  readonly values: (kind: UsageKind) => string[];
  /** A video's values of a kind, distinct, in its runs' order. */
  readonly ofVideo: (video: ExportedVideo, kind: UsageKind) => string[];
}

export function videosUsage(db: Executor, videos: readonly ExportedVideo[]): VideosUsage {
  const rows = usageOfRuns(
    db,
    videos.flatMap((v) => v.runIds),
  );
  const distinct = (list: readonly UsageValue[], kind: UsageKind) => [
    ...new Set(list.filter((r) => r.kind === kind).map((r) => r.value)),
  ];
  return {
    values: (kind) => distinct(rows, kind).sort(byCodeUnits),
    ofVideo: (video, kind) =>
      video.runIds.flatMap((id) =>
        distinct(
          rows.filter((r) => r.runId === id),
          kind,
        ),
      ),
  };
}

/** Each video's hooks and main pattern sequences, as the history checks read them. */
export function recentStructures(
  videos: readonly ExportedVideo[],
  usage: VideosUsage,
): RecentStructure[] {
  return videos.map((video) => ({
    title: video.title,
    hooks: [...new Set(usage.ofVideo(video, 'hook'))],
    sequences: [...new Set(usage.ofVideo(video, 'pattern_sequence'))],
  }));
}

/**
 * The last `count` videos' usage (`GET /api/memory/usage`, `studio usage`): each video's
 * structure, and per kind how many of them used each value.
 */
export function usageSummary(db: Executor, count: number): UsageSummary {
  const videos = exportedVideos(db).slice(0, count);
  const usage = videosUsage(db, videos);
  const counts = Object.fromEntries(
    USAGE_KINDS.map((kind): [UsageKind, UsageCount[]] => [kind, countsOf(videos, usage, kind)]),
  ) as Record<UsageKind, UsageCount[]>;
  return {
    videos: videos.map((video) => ({
      videoRunId: video.key,
      runIds: [...video.runIds],
      title: video.title,
      exportedAt: video.exportedAt.toISOString(),
      hooks: [...new Set(usage.ofVideo(video, 'hook'))],
      endings: [...new Set(usage.ofVideo(video, 'ending'))],
      sequences: [...new Set(usage.ofVideo(video, 'pattern_sequence'))],
    })),
    counts,
  };
}

function countsOf(
  videos: readonly ExportedVideo[],
  usage: VideosUsage,
  kind: UsageKind,
): UsageCount[] {
  const counts = new Map<string, number>();
  for (const video of videos) {
    for (const value of new Set(usage.ofVideo(video, kind))) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([value, n]) => ({ value, videos: n }))
    .sort((a, b) => b.videos - a.videos || byCodeUnits(a.value, b.value));
}
