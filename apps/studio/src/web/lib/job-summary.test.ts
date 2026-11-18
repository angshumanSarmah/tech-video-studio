import { describe, expect, it } from 'vitest';
import { makeEvent } from '#web/testing.ts';
import { summarizeJob } from './job-summary.ts';

describe('summarizeJob', () => {
  it('starts empty', () => {
    expect(summarizeJob([])).toEqual({ status: null, pct: 0, error: null, progress: [] });
  });

  it('takes the latest status and progress', () => {
    const p1 = makeEvent('progress', { pct: 20 });
    const p2 = makeEvent('progress', { pct: 40, message: 'step 2/5' });
    const summary = summarizeJob([
      makeEvent('job_status', { status: 'queued' }),
      makeEvent('job_status', { status: 'running' }),
      p1,
      makeEvent('log', { level: 'info', message: 'hi' }),
      p2,
    ]);
    expect(summary).toEqual({ status: 'running', pct: 40, error: null, progress: [p1, p2] });
  });

  it('carries the error of a failed job', () => {
    const summary = summarizeJob([makeEvent('job_status', { status: 'failed', error: 'boom' })]);
    expect(summary).toMatchObject({ status: 'failed', error: 'boom' });
  });
});
