import { describe, expect, it } from 'vitest';
import type { BeatScript } from '../spec/script.ts';
import {
  failedRequestOutcomes,
  failureReason,
  outcomeLine,
  requestOutcomes,
  type RepairableSpec,
} from './repair-outcome.ts';
import type { RepairRequest } from './repair.ts';

const beat = (beatId: string, narration: string): BeatScript => ({
  beatId,
  narration,
  tags: [],
  statCards: [],
});

const before: RepairableSpec = {
  script: [beat('b1', 'One.'), beat('b2', 'Two.')],
  scenes: [
    { beatId: 'b1', elements: [] } as never,
    { beatId: 'b2', elements: [{ id: 'card' }] } as never,
  ],
};

const issues = [{ code: 'reviewer_feedback', message: '<example-feedback>' }];
const sw: RepairRequest = { beatId: 'b2', owner: 'scriptwriter', fields: ['narration'], issues };
const gen: RepairRequest = { beatId: 'b2', owner: 'generator', fields: ['board'], issues };

describe('requestOutcomes', () => {
  it('changed when the request’s own part of the beat differs', () => {
    const after: RepairableSpec = {
      script: [before.script[0]!, beat('b2', 'Two, said again.')],
      scenes: [before.scenes[0]!, { beatId: 'b2', elements: [{ id: 'other' }] } as never],
    };
    expect(requestOutcomes([sw, gen], before, after).map((o) => o.outcome)).toEqual([
      'changed',
      'changed',
    ]);
  });

  it('unchanged, with a reason, when the agent gave back the same thing', () => {
    expect(requestOutcomes([sw, gen], before, before)).toEqual([
      {
        beatId: 'b2',
        owner: 'scriptwriter',
        fields: ['narration'],
        outcome: 'unchanged',
        reason: 'the Scriptwriter returned the same narration',
      },
      {
        beatId: 'b2',
        owner: 'generator',
        fields: ['board'],
        outcome: 'unchanged',
        reason: 'the Generator returned the same board',
      },
    ]);
  });

  it('judges each request by its own part: a new script alone leaves the board unchanged', () => {
    const after = { ...before, script: [before.script[0]!, beat('b2', 'New.')] };
    expect(requestOutcomes([sw, gen], before, after).map((o) => o.outcome)).toEqual([
      'changed',
      'unchanged',
    ]);
  });
});

describe('failedRequestOutcomes', () => {
  const error =
    'generator output is still invalid after 2 repair attempts:\n' +
    '- $.elements[0]: (advisory) <example-soft-issue>\n' +
    '- $: The board only fits at 66% (labels 15.8px; readable needs 75%).';

  it('every request unchanged, the first hard issue as the reason', () => {
    expect(failedRequestOutcomes([sw, gen], error)).toEqual(
      [sw, gen].map((r) => ({
        beatId: r.beatId,
        owner: r.owner,
        fields: r.fields,
        outcome: 'unchanged',
        reason:
          'the Generator could not make a valid change: The board only fits at 66% ' +
          '(labels 15.8px; readable needs 75%).',
      })),
    );
  });

  it('any other error is its first line', () => {
    expect(failureReason('Spec v3 is not renderable: repair needs boards.\nmore')).toBe(
      'Spec v3 is not renderable: repair needs boards.',
    );
    expect(failureReason('')).toBe('the repair failed');
  });

  it('reads as one line per request', () => {
    const [outcome] = failedRequestOutcomes([gen], error);
    expect(outcomeLine(outcome!)).toBe(
      'b2 board: unchanged: the Generator could not make a valid change: The board only fits ' +
        'at 66% (labels 15.8px; readable needs 75%).',
    );
  });
});
