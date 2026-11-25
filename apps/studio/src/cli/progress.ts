import type { StoredEvent } from '#core/db/repositories/events.ts';

/**
 * Progress as terminal lines (P1C.9b), pure: one line per pipeline step entered, per job that
 * ends (with its time and the run's cost so far) and per gate event, plus warning and error logs.
 * Percentages go to the live line only (null here).
 */

export interface LineContext {
  /** `run 12`, or `run 14 (part 2/2)`. */
  readonly label: string;
  /** The ending job's type and how long it ran, for `job_status`. */
  readonly job?: { readonly type: string; readonly seconds: number | null };
  /** The run's LLM cost so far, for a job that ends. */
  readonly costUsd?: number;
}

export function eventLine(event: StoredEvent, ctx: LineContext): string | null {
  switch (event.type) {
    case 'run_status':
      if (!event.payload.step) return `${ctx.label}: ${event.payload.status}`;
      return `${ctx.label} ▸ ${event.payload.step}${statusNote(event.payload.status)}`;
    case 'job_status':
      return jobLine(event.payload, ctx);
    case 'gate': {
      const { gate, status, decidedBy, blocking } = event.payload;
      const by = decidedBy ? ` (${decidedBy})` : '';
      const blocked =
        status === 'pending' && blocking.length > 0 ? ` · ${blocking.length} blocking` : '';
      return `${ctx.label} ◆ gate ${gate}: ${status}${by}${blocked}`;
    }
    case 'log':
      if (event.payload.level === 'info') return null;
      return `${ctx.label}   ${event.payload.level === 'error' ? '✗' : '!'} ${event.payload.message}`;
    case 'progress':
      return null;
  }
}

function statusNote(status: string): string {
  return status === 'running' || status === 'queued' ? '' : ` (${status})`;
}

function jobLine(payload: { status: string; error?: string | undefined }, ctx: LineContext) {
  const type = ctx.job?.type ?? 'job';
  const time = ctx.job?.seconds == null ? '' : ` ${ctx.job.seconds.toFixed(1)} s`;
  const cost = ctx.costUsd === undefined ? '' : ` · $${ctx.costUsd.toFixed(4)} so far`;
  switch (payload.status) {
    case 'done':
      return `${ctx.label}   ✓ ${type}${time}${cost}`;
    case 'failed':
      return `${ctx.label}   ✗ ${type} failed${time}: ${payload.error ?? 'no reason given'}`;
    case 'cancelled':
      return `${ctx.label}   ✗ ${type} cancelled`;
    default:
      return null;
  }
}

/** The live line for a progress event: `run 12 … generate 45% Beat 3 of 7`. */
export function progressLine(event: StoredEvent, label: string, jobType: string): string | null {
  if (event.type !== 'progress') return null;
  const message = event.payload.message ? ` ${event.payload.message}` : '';
  return `${label} … ${jobType} ${Math.round(event.payload.pct)}%${message}`;
}
