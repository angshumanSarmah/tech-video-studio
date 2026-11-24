import type { JobStatus, RunStatus } from '@explainer-studio/shared';

export type Status = RunStatus | JobStatus;

/**
 * Status -> text colour, using the theme's semantic tokens. Full class names so Tailwind's
 * scanner finds them.
 */
const STATUS_CLASSES: Record<Status, string> = {
  queued: 'text-ink-muted border-line',
  running: 'text-concept border-concept/40',
  awaiting_review: 'text-focus border-focus/40',
  paused: 'text-focus border-focus/40',
  done: 'text-ok border-ok/40',
  failed: 'text-problem border-problem/40',
  cancelled: 'text-ink-faint border-line',
};

export function statusClasses(status: Status): string {
  return STATUS_CLASSES[status];
}

export function statusLabel(status: Status): string {
  return status.replace('_', ' ');
}
