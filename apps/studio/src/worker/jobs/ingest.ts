import { PROGRESS_DONE_PCT } from '@explainer-studio/shared';
import { z } from 'zod';
import type { Db } from '#core/db/client.ts';
import { getRun, recordRunSources } from '#core/db/repositories/runs.ts';
import {
  listTopicSources,
  markSourceExtracted,
  markSourceFailed,
  type Source,
} from '#core/db/repositories/sources.ts';
import { NotFoundError } from '#core/errors.ts';
import { FIRST_RUN_JOB_TYPE } from '#core/services/runs.ts';
import { SourceIngestError } from '../ingest/errors.ts';
import type { FetchDeps } from '../ingest/fetch.ts';
import { ingestSource } from '../ingest/ingest-source.ts';
import { defineJobHandler, type JobContext, type JobHandler } from './handler.ts';

export const INGEST_JOB_TYPE = FIRST_RUN_JOB_TYPE;

export interface IngestJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  /** Tests inject a fake `fetch` and `sleep`; the worker uses the defaults. */
  readonly fetch?: FetchDeps;
  readonly now?: () => Date;
}

const PayloadSchema = z.strictObject({
  /**
   * Sources to fetch again even though they are extracted (a gate's "re-fetch this source",
   * P1C.9): a new text is pinned to the run in place of the old one; a failed fetch keeps it.
   */
  refetchSourceIds: z.array(z.number().int().positive()).default([]),
});
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

type Outcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Extracts every source of the run's topic that is not extracted yet (pending, or failed
 * before), one at a time, then pins the extracted versions to the run (`run_sources`), which is
 * the set the Researcher reads. A source that fails is marked `failed` with its reason and the
 * job carries on; the job fails only when no source is usable. Sources already extracted (by an
 * earlier run on the topic, or an interrupted attempt of this job) are reused, not re-fetched.
 */
export function ingestJobHandler(deps: IngestJobDeps): JobHandler {
  return defineJobHandler({
    type: INGEST_JOB_TYPE,
    description: 'Fetch and extract the topic’s sources, chunk them and pin them to the run.',
    payloadSchema: PayloadSchema,
    run: (ctx) => ingest(deps, ctx),
  });
}

async function ingest(deps: IngestJobDeps, ctx: Ctx): Promise<void> {
  const runId = ctx.job.runId;
  if (runId === null) throw new Error('An ingest job needs a run.');
  const run = getRun(deps.db, runId);
  if (!run) throw new NotFoundError('run', runId);
  const sources = listTopicSources(deps.db, run.topicId);
  if (sources.length === 0) {
    throw new Error('The topic has no sources: add URLs or files, then start a new run.');
  }

  const failures: string[] = [];
  const refetch = new Set(ctx.payload.refetchSourceIds);
  for (const id of refetch) {
    if (!sources.some((s) => s.id === id))
      throw new Error(`Source ${id} is not one of the topic's.`);
  }
  for (const [i, source] of sources.entries()) {
    const outcome = await ingestOne(deps, ctx, source, refetch.has(source.id));
    if (!outcome.ok) failures.push(`${describe(source)}: ${outcome.reason}`);
    ctx.progress(
      Math.round(((i + 1) / sources.length) * 95),
      `Source ${i + 1} of ${sources.length}`,
    );
  }

  const pinned = recordRunSources(deps.db, runId, [...refetch]);
  if (pinned.length === 0) {
    throw new Error(`No source could be extracted:\n${failures.map((f) => `  ${f}`).join('\n')}`);
  }
  const failed = failures.length > 0 ? ` (${failures.length} failed)` : '';
  ctx.log('info', `Using ${pinned.length} of ${sources.length} sources${failed}.`);
  ctx.progress(PROGRESS_DONE_PCT, 'Sources ingested');
}

async function ingestOne(
  deps: IngestJobDeps,
  ctx: Ctx,
  source: Source,
  refetch: boolean,
): Promise<Outcome> {
  const extracted = source.status === 'extracted' && source.contentHash !== null;
  if (extracted && !refetch) {
    ctx.log('info', `${describe(source)}: already extracted, reused.`);
    return { ok: true };
  }
  try {
    const result = await ingestSource(source, ctx.signal, deps);
    markSourceExtracted(deps.db, source.id, result);
    ctx.log(
      'info',
      `${describe(source)}: ${result.format}, ${result.chunkCount} chunk(s), "${result.title ?? ''}".`,
    );
    return { ok: true };
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    const failure = asFailure(error);
    if (extracted) {
      ctx.log(
        'warn',
        `${describe(source)}: fetching it again failed (${failure.message}); the earlier text stays.`,
      );
      return { ok: true };
    }
    markSourceFailed(deps.db, source.id, failure);
    ctx.log('warn', `${describe(source)} failed: ${failure.message}`);
    return { ok: false, reason: failure.message };
  }
}

/** Unexpected errors (a bug, a parser crash) fail the source too, so the others still run. */
function asFailure(error: unknown): SourceIngestError {
  if (error instanceof SourceIngestError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SourceIngestError('unreadable', `Extraction failed unexpectedly: ${message}`, {
    cause: error,
  });
}

function describe(source: Source): string {
  return `Source ${source.id} (${source.url ?? source.filePath ?? '?'})`;
}
