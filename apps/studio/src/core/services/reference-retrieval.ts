import { PATTERNS } from '@explainer-studio/renderer/catalog';
import {
  pickReferences,
  referenceBrief,
  type DirectorInput,
  type DirectorMemory,
  type DirectorReferences,
  type ReferenceNames,
  type ReferenceRecord,
  type ResearchNotes,
  type Retrieval,
  type TopicClass,
} from '@explainer-studio/shared';
import type { Executor } from '../db/client.ts';
import type { ReferenceRow } from '../db/repositories/references.ts';
import { listReferences, readReferenceRecord } from './references.ts';

/**
 * The reference library as the agents' steps read it (P1C.11): the Director's picks and briefs
 * (`directorReferences`, for its user message), and every ready reference's names to avoid, for
 * the originality check (`referenceNamesToAvoid`; code only).
 */

export interface ReadyReference {
  readonly row: ReferenceRow;
  readonly record: ReferenceRecord;
}

/** Ready references with their records, oldest first. */
export function readyReferences(db: Executor, dataDir: string): ReadyReference[] {
  return listReferences(db).flatMap((row) => {
    if (row.status !== 'ready') return [];
    const record = readReferenceRecord(dataDir, row);
    return record ? [{ row, record }] : [];
  });
}

/** Every ready reference's names, for the originality check. */
export function referenceNamesToAvoid(db: Executor, dataDir: string): ReferenceNames[] {
  return readyReferences(db, dataDir)
    .filter(({ record }) => record.namesToAvoid.length > 0)
    .map(({ row, record }) => ({ slug: row.slug, names: record.namesToAvoid }));
}

export interface DirectorReferenceRequest {
  readonly topicTitle: string;
  readonly seriesTag: string;
  readonly notes?: ResearchNotes;
  readonly previousTopicClass?: TopicClass;
  readonly memory: DirectorMemory;
}

/** The scoring of every ready reference for one Director call (also `studio references pick`). */
export function scoreReferences(
  db: Executor,
  dataDir: string,
  request: DirectorReferenceRequest,
): Retrieval {
  return pickReferences({
    topicTitle: request.topicTitle,
    seriesTag: request.seriesTag,
    ...(request.notes ? { notes: request.notes } : {}),
    ...(request.previousTopicClass ? { previousTopicClass: request.previousTopicClass } : {}),
    recent: {
      structures: request.memory.recent.structures ?? [],
      referencesShown: request.memory.recent.referencesShown ?? {},
    },
    references: readyReferences(db, dataDir).map(({ row, record }) => ({
      slug: row.slug,
      record,
    })),
  });
}

/** The picks and their briefs, as the Director step records and sends them. */
export function directorReferences(
  db: Executor,
  dataDir: string,
  request: DirectorReferenceRequest,
): DirectorReferences {
  const retrieval = scoreReferences(db, dataDir, request);
  const records = new Map(readyReferences(db, dataDir).map((r) => [r.row.slug, r.record]));
  const patterns = new Set(PATTERNS.keys());
  const briefs = retrieval.picks.flatMap((pick, i) => {
    const record = records.get(pick.slug);
    return record ? [referenceBrief(record, i, pick, patterns)] : [];
  });
  return {
    ...(retrieval.expected ? { expected: retrieval.expected } : {}),
    candidateDevices: [...retrieval.candidateDevices],
    picks: [...retrieval.picks],
    briefs,
  };
}

/** The usage rows an export records for the references its Director was shown. */
export function referenceUsage(input: DirectorInput | undefined) {
  return (input?.references?.picks ?? []).map((pick) => ({
    kind: 'reference' as const,
    value: pick.slug,
  }));
}
