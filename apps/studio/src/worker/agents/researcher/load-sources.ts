import { posix } from 'node:path';
import { SourceChunksFileSchema, type ResearchSource } from '@explainer-studio/shared';
import { readDataJson, sourceChunksPath } from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import { listRunSources } from '#core/db/repositories/runs.ts';
import { getSource } from '#core/db/repositories/sources.ts';

/**
 * Every source version pinned to the run (`run_sources`), with all its chunks, in source order.
 * Chunks come from the pinned content hash, so a later re-fetch never changes what a run reads.
 * Title and fetch date are the source row's (its latest version).
 */
export function loadRunSources(
  db: Db,
  dataDir: string,
  runId: number,
  topicId: number,
): ResearchSource[] {
  return listRunSources(db, runId).map((pin) => {
    const source = getSource(db, pin.sourceId);
    if (!source) throw new Error(`Pinned source ${pin.sourceId} no longer exists.`);
    const file = SourceChunksFileSchema.parse(
      readDataJson(dataDir, sourceChunksPath(topicId, pin.sourceId, pin.contentHash)),
    );
    return {
      sourceId: pin.sourceId,
      title: source.title,
      origin: source.url ?? posix.basename(source.filePath ?? `source-${pin.sourceId}`),
      fetchedAt: source.extractedAt?.toISOString() ?? null,
      contentHash: pin.contentHash,
      chunks: file.chunks.map(({ id, text }) => ({ id, text })),
    };
  });
}
