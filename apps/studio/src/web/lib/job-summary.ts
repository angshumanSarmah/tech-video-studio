import type { EventDto, JobStatus } from '@explainer-studio/shared';

export type ProgressEvent = Extract<EventDto, { type: 'progress' }>;

export interface JobSummary {
  /** Latest `job_status`, or null before the first one arrives. */
  readonly status: JobStatus | null;
  /** Latest progress percentage (0 before any progress). */
  readonly pct: number;
  readonly error: string | null;
  readonly progress: readonly ProgressEvent[];
}

export const isProgressEvent = (event: EventDto): event is ProgressEvent =>
  event.type === 'progress';

/** Folds a job's event stream into what the UI shows. Events arrive oldest first. */
export function summarizeJob(events: readonly EventDto[]): JobSummary {
  let status: JobStatus | null = null;
  let error: string | null = null;
  for (const event of events) {
    if (event.type !== 'job_status') continue;
    status = event.payload.status;
    error = event.payload.error ?? null;
  }
  const progress = events.filter(isProgressEvent);
  return { status, pct: progress.at(-1)?.payload.pct ?? 0, error, progress };
}
