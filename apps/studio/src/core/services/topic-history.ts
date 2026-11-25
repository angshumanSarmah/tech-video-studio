import {
  MAX_SIMILAR_TOPICS,
  TOPIC_SIMILARITY_WARN,
  topicSimilarity,
  type RunStatus,
  type TopicMatch,
} from '@explainer-studio/shared';
import { and, desc, inArray, isNull } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { getRun } from '../db/repositories/runs.ts';
import { getTopic } from '../db/repositories/topics.ts';
import { runs, topics } from '../db/schema.ts';
import { exportedVideos, videoKey } from './usage-history.ts';

/** A run still on its way: its topic counts as taken, like an exported one. */
const IN_PROGRESS: readonly RunStatus[] = ['queued', 'running', 'awaiting_review', 'paused'];

/** An earlier topic and the run that stands for it. */
interface Candidate {
  readonly topicId: number;
  readonly runId: number;
  readonly exportedAt: Date | null;
}

/**
 * Topic history (P1C.10): earlier topics whose title is close to this run's
 * (`topicSimilarity` ≥ `TOPIC_SIMILARITY_WARN`), closest first (on a tie, exported ones, then
 * the newest), at most `MAX_SIMILAR_TOPICS`.
 * Earlier means an exported video's topic (its newest export) or a video still in progress;
 * never the run's own topic or video. A warning only: the person may revisit a topic on purpose.
 */
export function similarTopics(db: Executor, runId: number): TopicMatch[] {
  const run = getRun(db, runId);
  if (!run) return [];
  const own = getTopic(db, run.topicId);
  if (!own) return [];
  const candidates = candidatesFor(db, runId, videoKey(run), own.id);
  if (candidates.length === 0) return [];
  const rows = db
    .select()
    .from(topics)
    .where(
      inArray(
        topics.id,
        candidates.map((c) => c.topicId),
      ),
    )
    .all();
  const byId = new Map(rows.map((t) => [t.id, t]));
  return candidates
    .flatMap((c): TopicMatch[] => {
      const topic = byId.get(c.topicId);
      if (!topic) return [];
      const score = Math.round(topicSimilarity(own.title, topic.title) * 100) / 100;
      if (score < TOPIC_SIMILARITY_WARN) return [];
      return [
        {
          topicId: topic.id,
          title: topic.title,
          angle: topic.notes,
          runId: c.runId,
          exportedAt: c.exportedAt?.toISOString() ?? null,
          score,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.exportedAt !== null) - Number(a.exportedAt !== null) ||
        b.runId - a.runId,
    )
    .slice(0, MAX_SIMILAR_TOPICS);
}

/** One candidate per earlier topic: its newest exported video, else its newest run in progress. */
function candidatesFor(
  db: Executor,
  runId: number,
  ownKey: number,
  ownTopicId: number,
): Candidate[] {
  const byTopic = new Map<number, Candidate>();
  for (const video of exportedVideos(db, { excludeVideoOf: runId })) {
    for (const topicId of video.topicIds) {
      if (topicId === ownTopicId || byTopic.has(topicId)) continue;
      byTopic.set(topicId, { topicId, runId: video.newestRunId, exportedAt: video.exportedAt });
    }
  }
  const active = db
    .select({ id: runs.id, topicId: runs.topicId })
    .from(runs)
    .where(and(isNull(runs.parentRunId), inArray(runs.status, [...IN_PROGRESS])))
    .orderBy(desc(runs.id))
    .all();
  for (const other of active) {
    if (other.id === ownKey || other.topicId === ownTopicId || byTopic.has(other.topicId)) continue;
    byTopic.set(other.topicId, { topicId: other.topicId, runId: other.id, exportedAt: null });
  }
  return [...byTopic.values()];
}
