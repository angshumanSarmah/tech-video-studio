import { describe, expect, it } from 'vitest';
import { ResearchNotesSchema, type ResearchNotes } from '../research/notes.ts';
import { reviewPassProblems } from './claims-checks.ts';
import {
  claimConditionIssues,
  conditionStated,
  droppedConditions,
  numberConditions,
  stem,
} from './conditions.ts';
import type { ReviewBeatTexts } from './review-checks.ts';
import type { Claim } from './review.ts';

/**
 * Run 1 ("How Redis works"), beat b1: the hook said "a million requests per second" and the
 * Curator marked it supported by num-2, whose context says the figure needs pipelining.
 */
const C = ['source-1#chunk-7'];
const NUM_2_CONTEXT =
  'Throughput a Redis instance on an average Linux system can deliver when using pipelining.';
const B1 = 'How can a single Redis worker serve a million requests per second?';

function notes(): ResearchNotes {
  return ResearchNotesSchema.parse({
    mechanism: {
      summary: 'One loop.',
      sourceChunkIds: C,
      steps: [{ text: 'Run one command.', sourceChunkIds: C }],
    },
    plainSummary: 'One worker runs every command.',
    analogies: [{ analogy: 'A single till.', matches: 'Order.', breaksDown: 'Speed.' }],
    glossary: [{ term: 'event loop', plainMeaning: 'One worker.', sourceChunkIds: C }],
    facts: [
      {
        id: 'fact-12',
        statement:
          'A Redis instance on an average Linux system can deliver 1 million requests per ' +
          'second with pipelining.',
        sourceChunkIds: C,
        confidence: 'high',
      },
    ],
    numbers: [
      {
        id: 'num-2',
        value: '1 million',
        unit: 'requests per second',
        context: NUM_2_CONTEXT,
        sourceChunkId: C[0],
      },
      {
        id: 'num-1',
        value: '1000',
        unit: 'times',
        context: 'How much faster RAM access is than random disk access, at minimum.',
        sourceChunkId: C[0],
      },
    ],
    tradeOffs: [],
    rejectedAlternatives: [],
    misconceptions: [],
    failureModes: [],
    hooks: [
      { situation: 'A busy store.', sourceChunkIds: C },
      { situation: 'One worker.', sourceChunkIds: C },
    ],
    openQuestions: [],
  });
}

/** The claim exactly as the run's last review recorded it. */
const recorded: Claim = {
  beatId: 'b1',
  source: 'narration',
  text: B1,
  verdict: 'supported',
  ids: ['num-2', 'fact-12'],
  restates: {
    claim: 'a Redis instance delivers 1 million requests per second',
    fact: 'a Redis instance on an average Linux system delivers 1 million requests per second with pipelining',
  },
};

const BEATS: ReviewBeatTexts[] = [
  {
    beatId: 'b1',
    narration: `${B1} Nearly every command runs on one main thread.`,
    headline: [],
    tag: [],
    stat_card: [],
    source: [],
    labels: {},
    drawnValues: [],
  },
];
const ctx = { beats: BEATS, notes: notes() };
const second = (): Claim => ({
  ...recorded,
  text: 'Nearly every command runs on one main thread.',
  verdict: 'no_claim',
  ids: [],
});

describe('numberConditions', () => {
  it('reads the condition a number holds under, and nothing from a plain context', () => {
    expect(numberConditions(NUM_2_CONTEXT)).toEqual([
      { text: 'when using pipelining', stems: ['pipelin'] },
    ]);
    expect(numberConditions('How much faster RAM is than disk, at minimum.')).toEqual([]);
    // "with" and "under" name a party or a scope as often as a condition.
    expect(numberConditions('Contracted rate with the payment provider.')).toEqual([]);
    expect(numberConditions('Token counts under the same tokenizer.')).toEqual([]);
  });

  it('matches a condition by stem, in the sentence or another text', () => {
    const [condition] = numberConditions(NUM_2_CONTEXT);
    expect(stem('pipelined')).toBe(stem('pipelining'));
    expect(conditionStated(condition!, ['with a pipeline of commands'])).toBe(true);
    expect(conditionStated(condition!, [B1])).toBe(false);
  });
});

describe('claim_drops_condition (run 1, b1)', () => {
  it('the recorded claim fails: num-2 holds only when using pipelining', () => {
    expect(
      droppedConditions(recorded.ids, [recorded.text, recorded.restates!.claim], notes()),
    ).toHaveLength(1);
    const problems = reviewPassProblems(
      'claims',
      { claims: [recorded, second()], issues: [] },
      ctx,
    );
    expect(problems.map((p) => `${p.path} ${p.code}`)).toEqual([
      '$.claims[0].restates.claim claim_drops_condition',
    ]);
    expect(problems[0]!.message).toContain('num-2 holds only when using pipelining');
  });

  it('passes when the narration says it, or the restatement names it in other words', () => {
    const said = { ...recorded, text: `${B1.slice(0, -1)} with pipelining?` };
    const narration = `${said.text} Nearly every command runs on one main thread.`;
    const beats = [{ ...BEATS[0]!, narration }];
    expect(
      reviewPassProblems('claims', { claims: [said, second()], issues: [] }, { ...ctx, beats }),
    ).toEqual([]);
    // "when commands are sent in batches": the Curator restates it as pipelining.
    const batches: Claim = {
      ...recorded,
      restates: { ...recorded.restates!, claim: 'pipelined commands reach 1 million a second' },
    };
    expect(reviewPassProblems('claims', { claims: [batches, second()], issues: [] }, ctx)).toEqual(
      [],
    );
  });

  it('what the review leaves is a blocking code issue on the narration, for the Scriptwriter', () => {
    const script = [{ beatId: 'b0' }, { beatId: 'b1' }];
    const issues = claimConditionIssues([recorded, recorded], notes(), script);
    expect(issues.map(({ message: _, ...rest }) => rest)).toEqual([
      {
        path: '$.script[1].narration',
        code: 'claim_drops_condition',
        severity: 'blocking',
        owner: 'scriptwriter',
      },
    ]);
    expect(issues[0]!.message).toContain('num-2 holds only when using pipelining');
    expect(claimConditionIssues([{ ...recorded, verdict: 'issue' }], notes(), script)).toEqual([]);
  });
});

describe('scoped coverage', () => {
  it('lists only the covered beats; a board-only round lists no sentence', () => {
    const scoped = { ...ctx, coverage: { beatIds: ['b9'], narration: true } };
    expect(reviewPassProblems('claims', { claims: [], issues: [] }, scoped)).toEqual([]);
    const boardOnly = { ...ctx, coverage: { beatIds: ['b1'], narration: false } };
    expect(reviewPassProblems('claims', { claims: [], issues: [] }, boardOnly)).toEqual([]);
    const full = reviewPassProblems('claims', { claims: [], issues: [] }, ctx);
    expect(full.map((p) => p.code)).toEqual(['claim_missing', 'claim_missing']);
  });
});
