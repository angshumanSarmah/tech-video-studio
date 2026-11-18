import { PROGRESS_DONE_PCT } from '@explainer-studio/shared';
import { z } from 'zod';
import { NOOP_JOB_TYPE } from '#core/services/jobs.ts';
import { sleep } from '../sleep.ts';
import { defineJobHandler } from './handler.ts';

export const NoopPayloadSchema = z.strictObject({
  steps: z.number().int().min(1).max(20).default(5),
  /** Default matches the progress throttle window, so every step reaches the UI live. */
  stepMs: z.number().int().min(0).max(10_000).default(1_000),
});

/** Demo job: reports `steps` evenly spaced progress events, then finishes. No side effects. */
export const noopJob = defineJobHandler({
  type: NOOP_JOB_TYPE,
  description: 'Demo job that emits evenly spaced progress events and does nothing else.',
  payloadSchema: NoopPayloadSchema,
  async run({ payload, progress, signal }) {
    for (let step = 1; step <= payload.steps; step++) {
      await sleep(payload.stepMs, signal);
      progress((step / payload.steps) * PROGRESS_DONE_PCT, `step ${step}/${payload.steps}`);
    }
  },
});
