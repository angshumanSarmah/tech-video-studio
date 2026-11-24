import { describe, expect, it } from 'vitest';
import { ResearchNotesSchema, type ResearchNotes } from '../research/notes.ts';
import { reviewPassProblems } from './claims-checks.ts';
import type { ReviewBeatTexts } from './review-checks.ts';
import type { Claim, CuratorIssue } from './review.ts';

const C = ['source-1#chunk-1'];

function notes(): ResearchNotes {
  return ResearchNotesSchema.parse({
    mechanism: {
      summary: 'A bucket refills.',
      sourceChunkIds: C,
      steps: [{ text: 'Spend one.', sourceChunkIds: C }],
    },
    plainSummary: 'Each user gets a few tries a minute.',
    analogies: [{ analogy: 'A ticket roll.', matches: 'Tries.', breaksDown: 'No refill.' }],
    glossary: [{ term: 'token bucket', plainMeaning: 'A refilling allowance.', sourceChunkIds: C }],
    facts: [
      {
        id: 'fact-1',
        statement: 'A bucket per node gives a client 24 times its limit.',
        sourceChunkIds: C,
        confidence: 'high',
      },
    ],
    numbers: [
      { id: 'num-1', value: '24', unit: 'gateway nodes', context: '<c>', sourceChunkId: C[0] },
    ],
    tradeOffs: [],
    rejectedAlternatives: [],
    misconceptions: [],
    failureModes: [],
    hooks: [
      { situation: 'A flood.', sourceChunkIds: C },
      { situation: 'A bucket.', sourceChunkIds: C },
    ],
    openQuestions: [],
  });
}

const BEATS: ReviewBeatTexts[] = [
  {
    beatId: 'beat3',
    narration: 'So why not one bucket per node? A client gets twenty-four times its limit.',
    headline: [],
    tag: [],
    stat_card: [],
    source: [],
    labels: {
      limit: ['times its limit', '24'],
      bucket: ['capacity', '100', '99'],
      store: ['SHARED STORE'],
    },
    drawnValues: [
      { elementId: 'limit', key: 'value', value: '24', valueKey: '24' },
      { elementId: 'bucket', key: 'from', value: '100', valueKey: '100' },
      { elementId: 'bucket', key: 'to', value: '99', valueKey: '99' },
    ],
  },
];

const ctx = { beats: BEATS, notes: notes() };

function claim(change: Partial<Claim> = {}): Claim {
  return {
    beatId: 'beat3',
    source: 'narration',
    text: 'A client gets twenty-four times its limit.',
    verdict: 'supported',
    ids: ['fact-1'],
    restates: { claim: 'a client gets', fact: 'a bucket per node gives' },
    ...change,
  };
}

const value = (elementId: string, text: string, label: string, ids: string[]): Claim =>
  claim({ source: 'value', elementId, text, label, ids });

const allClaims = (): Claim[] => [
  claim({ text: 'So why not one bucket per node?', verdict: 'no_claim', ids: [] }),
  claim(),
  value('limit', '24', 'times its limit', ['num-1']),
  value('bucket', '100', 'capacity', ['num-1']),
  value('bucket', '99', 'capacity', ['num-1']),
];

const issue: CuratorIssue = {
  beatId: 'beat3',
  category: 'unsupported_claim',
  severity: 'blocking',
  owner: 'scriptwriter',
  fields: ['narration'],
  evidence: [{ kind: 'narration', quote: 'twenty-four times its limit' }],
  problem: '<example-problem>',
  fix: '<example-fix>',
};

const codes = (pass: 'claims' | 'story', value: unknown) =>
  reviewPassProblems(pass, value, ctx).map((p) => `${p.path} ${p.code}`);

describe('reviewPassProblems: PASS claims', () => {
  it('passes a complete audit', () => {
    expect(codes('claims', { claims: allClaims(), issues: [] })).toEqual([]);
  });

  it('asks for every sentence and every drawn value (the coverage repair)', () => {
    const [, said] = allClaims();
    const problems = reviewPassProblems('claims', { claims: [said], issues: [] }, ctx);
    expect(problems.map((p) => p.code)).toEqual([
      'claim_missing',
      'value_claim_missing',
      'value_claim_missing',
      'value_claim_missing',
    ]);
    expect(problems[0]?.message).toContain('"So why not one bucket per node?" is not listed');
  });

  it("lists a counter's start and end as two entries, each read with its label", () => {
    const claims = allClaims().filter((c) => c.text !== '99');
    expect(reviewPassProblems('claims', { claims, issues: [] }, ctx).map((p) => p.message)).toEqual(
      [expect.stringContaining('"bucket" draws 99 (to) but it is not listed')],
    );
    const misread = [...allClaims().slice(0, 4), value('bucket', '99', 'tokens left', ['num-1'])];
    expect(codes('claims', { claims: misread, issues: [] })).toEqual([
      '$.claims[4].label quote_not_found',
    ]);
  });

  it("needs a supported claim to restate its subject and verb next to the fact's", () => {
    const claims = allClaims();
    const bare = { ...claims[1]! };
    delete bare.restates;
    claims[1] = bare;
    expect(codes('claims', { claims, issues: [] })).toEqual([
      '$.claims[1].restates claim_restatement_missing',
    ]);
  });

  it('checks each claim: its text, its ids, and an issue for an issue verdict', () => {
    const claims = allClaims();
    claims[1] = claim({ ids: [] });
    expect(codes('claims', { claims, issues: [] })).toEqual(['$.claims[1].ids claim_ids_missing']);
    claims[1] = claim({ ids: ['fact-9'] });
    expect(codes('claims', { claims, issues: [] })).toEqual([
      '$.claims[1].ids[0] unknown_research_id',
    ]);
    claims[1] = claim({ verdict: 'issue', ids: [] });
    expect(codes('claims', { claims, issues: [] })).toEqual([
      '$.claims[1].verdict claim_issue_missing',
    ]);
    expect(codes('claims', { claims, issues: [issue] })).toEqual([]);
    claims[1] = claim({ text: 'A client gets twenty times its limit.' });
    expect(codes('claims', { claims, issues: [] })).toEqual([
      '$.claims claim_missing',
      '$.claims[1].text quote_not_found',
    ]);
  });

  it('keeps each category in its pass', () => {
    expect(codes('story', { issues: [issue] })).toEqual([
      '$.issues[0].category category_not_in_pass',
    ]);
    const story = { ...issue, category: 'hook_retold' as const };
    expect(codes('claims', { claims: allClaims(), issues: [story] })).toEqual([
      '$.issues[0].category category_not_in_pass',
    ]);
  });
});
