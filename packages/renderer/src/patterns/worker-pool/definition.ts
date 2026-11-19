import { z } from 'zod';
import { lineText } from '../../primitives/common-props.ts';
import { el, link, nodeParam, nodeProps, nth, numbered, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'queue', description: 'The queue of waiting jobs and the idle workers appear.' },
  { name: 'assign', description: 'Each worker takes the job at the front of the queue.' },
  { name: 'done', description: 'Each worker produces its output.' },
] as const;

export const workerPoolPattern = definePattern({
  id: 'worker_pool',
  family: 'flow',
  layoutMode: 'pipeline',
  paramsSchema: z
    .strictObject({
      queue: lineText(24, 'Optional caption under the queue, e.g. JOB QUEUE.').optional(),
      jobs: z
        .array(lineText(7, 'Short label of one job, e.g. an order number.'))
        .min(2)
        .max(6)
        .describe('Waiting jobs in arrival order, 2 to 6; the first is at the front.'),
      workers: z
        .array(nodeParam('One worker.'))
        .min(2)
        .max(4)
        .describe('The workers, 2 to 4 (at most one per job).'),
      output: lineText(24, 'What each worker produces, e.g. THUMBNAIL.'),
      at: anchorsSchema(ANCHORS),
    })
    .refine((p) => p.workers.length <= p.jobs.length, {
      message: 'Each worker takes one job: list at least as many jobs as workers.',
      path: ['workers'],
    }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  anchors: ANCHORS,
  targets: [
    { id: 'queue', description: 'The job queue; its jobs are parts job-1, job-2, …' },
    { id: 'worker-<n>', description: 'The n-th worker (from 1).' },
    { id: 'link-<n>', description: 'Arrow from the queue to the n-th worker.' },
    { id: 'output-<n>', description: 'The output of the n-th worker.' },
  ],
  description: {
    summary:
      'A queue of waiting jobs feeds a pool of workers: on the assign word each worker takes the ' +
      'job at the front (the jobs lift off the belt) and works on it, then each produces an ' +
      'output.',
    whenToUse:
      'Background jobs, consumers on a queue, thread pools, parallel inference: work waiting its ' +
      'turn and shared out across several workers.',
    whenNotToUse:
      'One message copied to every target (use `fan_out`); a single queue with no workers (use ' +
      'a `conveyor_queue`).',
  },
  example: {
    params: {
      queue: '<example-queue>',
      jobs: ['<ex-1>', '<ex-2>', '<ex-3>'],
      workers: [{ title: '<example-worker-1>' }, { title: '<example-worker-2>' }],
      output: '<example-output>',
      at: {
        queue: { type: 'word', index: 0 },
        assign: { type: 'word', index: 1 },
        done: { type: 'word', index: 2 },
      },
    },
  },
  expand: (p) => {
    const workers = numbered('worker', p.workers.length);
    const links = numbered('link', p.workers.length);
    const outputs = numbered('output', p.workers.length);
    const taken = numbered('job', p.workers.length);
    return {
      elements: [
        el(
          'queue',
          'conveyor_queue',
          {
            items: p.jobs.map((label, i) => ({ id: nth('job', i), label })),
            ...(p.queue ? { label: p.queue } : {}),
          },
          'source',
        ),
        ...p.workers.map((w, i) => el(nth('worker', i), 'node_card', nodeProps(w), 'stage')),
        ...workers.map((w, i) => link(nth('link', i), 'queue', w)),
        ...outputs.map((id, i) =>
          el(id, 'tag', {
            text: p.output,
            semantic: 'ok',
            pin: { to: nth('worker', i), side: 'bottom' },
          }),
        ),
      ],
      events: [
        on(p.at.queue, 'enter', ['queue', ...workers]),
        on(p.at.assign, 'exit', ['queue'], taken),
        on(p.at.assign, 'enter', links),
        on(p.at.assign, 'move', links),
        on(p.at.assign, 'lock', workers),
        on(p.at.done, 'enter', outputs),
        on(p.at.done, 'pulse', workers),
      ],
    };
  },
});
