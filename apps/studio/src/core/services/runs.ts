import type { RunSettingsInput, Stage } from '@explainer-studio/shared';
import type { Db, Executor } from '../db/client.ts';
import { enqueueJob, type Job } from '../db/repositories/jobs.ts';
import { appendRunEvent } from '../db/repositories/run-events.ts';
import { createRun, type Run } from '../db/repositories/runs.ts';
import { getSeries } from '../db/repositories/series.ts';
import { getTopic } from '../db/repositories/topics.ts';
import { NotFoundError } from '../errors.ts';

/** Job type that starts a run's pipeline. Its worker handler lands with ingestion (P1C). */
export const FIRST_RUN_JOB_TYPE = 'ingest' satisfies Stage;

export interface StartRunInput {
  readonly topicId: number;
  readonly seriesId: number;
  readonly settings?: RunSettingsInput | undefined;
}

export interface StartedRun {
  readonly run: Run;
  readonly job: Job;
}

/**
 * Creates a run, queues its first job and records a `status` event, all in one transaction, so a
 * run never exists without the job that drives it.
 */
export function startRun(db: Db, input: StartRunInput): StartedRun {
  return db.transaction((tx) => {
    assertReferencesExist(tx, input);
    const run = createRun(tx, input);
    const job = enqueueJob(tx, { type: FIRST_RUN_JOB_TYPE, runId: run.id });
    appendRunEvent(tx, {
      runId: run.id,
      jobId: job.id,
      type: 'status',
      payload: { status: run.status },
    });
    return { run, job };
  });
}

/** Clear 404s instead of a bare FOREIGN KEY failure. */
function assertReferencesExist(db: Executor, input: StartRunInput): void {
  if (!getTopic(db, input.topicId)) throw new NotFoundError('Topic', input.topicId);
  if (!getSeries(db, input.seriesId)) throw new NotFoundError('Series', input.seriesId);
}
