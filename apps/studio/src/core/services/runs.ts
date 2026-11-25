import {
  topicMatchMessage,
  type RunSettingsInput,
  type RunSettingsSource,
  type Stage,
  type TopicMatch,
} from '@explainer-studio/shared';
import type { Db, Executor } from '../db/client.ts';
import { enqueueJob, type Job } from '../db/repositories/jobs.ts';
import { appendEvent, latestEventId } from '../db/repositories/events.ts';
import {
  createRun,
  getRun,
  getRunSummary,
  setPipelineStep,
  type Run,
  type RunSummary,
} from '../db/repositories/runs.ts';
import { getSeries } from '../db/repositories/series.ts';
import { getTopic } from '../db/repositories/topics.ts';
import { NotFoundError } from '../errors.ts';
import { similarTopics } from './topic-history.ts';

/** Job type that starts a run's pipeline: source ingestion (`#worker/jobs/ingest.ts`). */
export const FIRST_RUN_JOB_TYPE = 'ingest' satisfies Stage;

export interface StartRunInput {
  readonly topicId: number;
  readonly seriesId: number;
  readonly settings?: RunSettingsInput | undefined;
  /** The app settings as they are now: the run's settings snapshot resolves from them. */
  readonly app: RunSettingsSource;
}

export interface StartedRun {
  readonly run: Run;
  readonly job: Job;
  /** Earlier topics close to this one (P1C.10, topic history): warnings, also logged on the run. */
  readonly warnings: TopicMatch[];
}

/**
 * Creates a run, queues its first job and records a `run_status` event, all in one transaction, so a
 * run never exists without the job that drives it. A topic close to an earlier one is a `warn`
 * log event on the run and comes back in `warnings`; it never stops the run.
 */
export function startRun(db: Db, input: StartRunInput): StartedRun {
  return db.transaction((tx) => {
    assertReferencesExist(tx, input);
    const run = createRun(tx, input);
    const job = enqueueJob(tx, { type: FIRST_RUN_JOB_TYPE, runId: run.id });
    setPipelineStep(tx, run.id, 'ingest', job.id);
    appendEvent(tx, {
      runId: run.id,
      jobId: job.id,
      type: 'run_status',
      payload: { status: run.status, step: 'ingest' },
    });
    const warnings = similarTopics(tx, run.id);
    for (const match of warnings) {
      appendEvent(tx, {
        runId: run.id,
        type: 'log',
        payload: { level: 'warn', message: topicMatchMessage(match) },
      });
    }
    return { run: getRun(tx, run.id)!, job, warnings };
  });
}

export interface RunDetail {
  readonly run: RunSummary;
  /** Id of the run's newest event: the SSE cursor that continues from this snapshot. */
  readonly lastEventId: number;
}

/**
 * Reads a run and its event cursor in one read transaction, so no event can land between the
 * snapshot and the cursor (it would be missed by a client that resumes `after` it).
 */
export function getRunDetail(db: Db, id: number): RunDetail {
  return db.transaction((tx) => {
    const run = getRunSummary(tx, id);
    if (!run) throw new NotFoundError('Run', id);
    return { run, lastEventId: latestEventId(tx, { runId: id }) };
  });
}

/** Clear 404s instead of a bare FOREIGN KEY failure. */
function assertReferencesExist(db: Executor, input: StartRunInput): void {
  if (!getTopic(db, input.topicId)) throw new NotFoundError('Topic', input.topicId);
  if (!getSeries(db, input.seriesId)) throw new NotFoundError('Series', input.seriesId);
}
