import { describe, expect, it } from 'vitest';
import { ResearchNotesSchema, type ResearchNotes } from '../research/notes.ts';
import {
  CATEGORY_RULES,
  capSeverity,
  CuratorReviewSchema,
  REVIEW_CATEGORIES,
  type CuratorIssue,
} from './review.ts';
import { curatorIssueProblems, quoteFound, type ReviewBeatTexts } from './review-checks.ts';

const C = ['source-1#chunk-1'];

/** Invented notes: one fact, two numbers sharing the value 24, a trade-off. */
function notes(): ResearchNotes {
  const number = (id: string, value: string, unit: string) => ({
    id,
    value,
    unit,
    context: '<example-context>',
    sourceChunkId: C[0],
  });
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
        statement: 'The gateway runs 24 nodes, so a bucket per node gives 24 times the limit.',
        sourceChunkIds: C,
        confidence: 'high',
      },
    ],
    numbers: [
      number('num-1', '24', 'gateway nodes'),
      number('num-2', '24', 'times its limit'),
      number('num-3', '40', 'instances'),
    ],
    tradeOffs: [
      {
        choice: 'One shared store',
        gains: 'One limit for the fleet.',
        costs: 'A network round trip on every request.',
        sourceChunkIds: C,
      },
    ],
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
    narration: 'Across, say, twenty-four nodes, a client gets twenty-four times its limit.',
    headline: ['Shared store = one bucket'],
    tag: ['bucket per node'],
    stat_card: [],
    source: [],
    labels: { nodes: ['GATEWAY A', 'one of 40 nodes'], limit: ['times its limit', '24'] },
  },
];

/** A verified issue: a node label shows 40, the instance count, as a node count. */
function issue(change: (i: CuratorIssue) => void = () => undefined): CuratorIssue {
  const value: CuratorIssue = {
    beatId: 'beat3',
    category: 'number_wrong_meaning',
    severity: 'blocking',
    owner: 'generator',
    fields: ['board'],
    evidence: [
      { kind: 'label', elementId: 'nodes', quote: 'one of 40 nodes' },
      { kind: 'number', id: 'num-3' },
    ],
    problem: '<example-problem>',
    fix: '<example-fix>',
  };
  change(value);
  return value;
}

const check = (issues: unknown[], previousIds?: string[]) =>
  curatorIssueProblems(
    { issues },
    { beats: BEATS, notes: notes(), ...(previousIds ? { previousIds } : {}) },
  ).map((p) => `${p.path} ${p.code}`);

describe('CuratorReviewSchema', () => {
  it('accepts a verified issue, and an empty review', () => {
    expect(CuratorReviewSchema.safeParse({ issues: [issue()] }).success).toBe(true);
    expect(CuratorReviewSchema.safeParse({ issues: [] }).success).toBe(true);
  });

  it('has a rule for every category, each owner list non-empty', () => {
    for (const category of REVIEW_CATEGORIES) {
      expect(CATEGORY_RULES[category].owners.length).toBeGreaterThan(0);
    }
  });
});

describe('curatorIssueProblems', () => {
  it('passes an issue whose evidence is all there', () => {
    expect(check([issue()])).toEqual([]);
  });

  it('flags a quote that is not in the beat (a paraphrase)', () => {
    const paraphrased = issue((i) => {
      i.category = 'unsupported_claim';
      i.owner = 'scriptwriter';
      i.fields = ['narration'];
      i.evidence = [{ kind: 'narration', quote: 'a client gets twenty-four times the limit' }];
    });
    expect(check([paraphrased])).toEqual(['$.issues[0].evidence[0].quote quote_not_found']);
  });

  it('accepts a quote with words left out, typographic quotes and its end punctuation', () => {
    expect(quoteFound('“Across, say ... its limit.”', [BEATS[0]!.narration])).toBe(true);
    expect(quoteFound('its limit ... Across', [BEATS[0]!.narration])).toBe(false);
    expect(quoteFound('ONE OF 40 NODES', ['one of 40 nodes'])).toBe(true);
  });

  it('flags unknown ids: a beat, an element, a fact and a number', () => {
    expect(check([issue((i) => (i.beatId = 'beat9'))])).toEqual([
      '$.issues[0].beatId unknown_beat',
    ]);
    const unknown = issue((i) => {
      i.evidence = [
        { kind: 'label', elementId: 'gateway', quote: 'GATEWAY A' },
        { kind: 'fact', id: 'fact-7' },
        { kind: 'number', id: 'num-9' },
      ];
    });
    expect(check([unknown])).toEqual([
      '$.issues[0].evidence[0].elementId unknown_element',
      '$.issues[0].evidence[1].id unknown_research_id',
      '$.issues[0].evidence[2].id unknown_research_id',
    ]);
  });

  it('flags a meaning issue whose quotes state no value of its number', () => {
    const wrongNumber = issue((i) => (i.evidence[1] = { kind: 'number', id: 'num-1' }));
    expect(check([wrongNumber])).toEqual(['$.issues[0].evidence[1] number_not_in_quote']);
    const noQuote = issue((i) => (i.evidence = [{ kind: 'number', id: 'num-3' }]));
    expect(check([noQuote])).toEqual(['$.issues[0].evidence[0] number_not_in_quote']);
  });

  it('flags evidence the category needs but lacks', () => {
    const noLabel = issue((i) => {
      i.category = 'visual_contradicts';
      i.evidence = [{ kind: 'narration', quote: 'twenty-four nodes' }];
    });
    expect(check([noLabel])).toEqual(['$.issues[0].evidence evidence_missing']);
  });

  it('flags an owner the category does not allow, and fields that are not the owner’s', () => {
    const wrongOwner = issue((i) => {
      i.category = 'visual_contradicts';
      i.owner = 'scriptwriter';
      i.fields = ['narration'];
    });
    expect(check([wrongOwner])).toEqual(['$.issues[0].owner owner_not_allowed']);
    const wrongField = issue((i) => (i.fields = ['board', 'narration']));
    expect(check([wrongField])).toEqual(['$.issues[0].fields[1] field_not_owned']);
  });

  it('checks fact and note quotes against the notes', () => {
    const tradeOff = issue((i) => {
      i.category = 'missing_trade_off';
      i.severity = 'advisory';
      i.owner = 'director';
      i.fields = ['plan'];
      i.evidence = [
        { kind: 'note', quote: 'A network round trip on every request' },
        { kind: 'fact', id: 'fact-1', quote: 'gives 24 times the limit' },
      ];
    });
    expect(check([tradeOff])).toEqual([]);
    tradeOff.evidence = [{ kind: 'note', quote: 'Every request costs a disk write' }];
    expect(check([tradeOff])).toEqual(['$.issues[0].evidence[0].quote quote_not_found']);
  });

  it('needs one status per earlier issue in a second round', () => {
    const ids = ['issue-1', 'issue-2'];
    const review = (previous: unknown) =>
      curatorIssueProblems(
        { issues: [], previous },
        { beats: BEATS, notes: notes(), previousIds: ids },
      ).map((p) => `${p.path} ${p.code}`);
    expect(
      review([
        { id: 'issue-1', status: 'fixed' },
        { id: 'issue-2', status: 'not_fixed' },
      ]),
    ).toEqual([]);
    expect(
      review([
        { id: 'issue-1', status: 'fixed' },
        { id: 'issue-7', status: 'fixed' },
      ]),
    ).toEqual(['$.previous[1].id unknown_previous_issue', '$.previous previous_status_missing']);
  });

  it('takes any JSON value (it also runs on answers that fail the schema)', () => {
    expect(curatorIssueProblems('not json', { beats: BEATS, notes: notes() })).toEqual([]);
    expect(check([null, { beatId: 'beat3' }, issue()])).toEqual([]);
  });
});

describe('capSeverity', () => {
  it('lowers a severity above its category cap, never raises one', () => {
    const distracting = issue((i) => {
      i.category = 'visual_distracts';
      i.evidence = [{ kind: 'label', elementId: 'nodes', quote: 'GATEWAY A' }];
    });
    expect(capSeverity(distracting, 'beginner').severity).toBe('advisory');
    const meaning = issue((i) => (i.severity = 'advisory'));
    expect(capSeverity(meaning, 'expert').severity).toBe('advisory');
    expect(capSeverity(issue(), 'expert').severity).toBe('blocking');
  });

  it('lets clarity block at beginner only', () => {
    const level = issue((i) => {
      i.category = 'above_level';
      i.owner = 'scriptwriter';
      i.fields = ['narration'];
    });
    expect(capSeverity(level, 'beginner').severity).toBe('blocking');
    expect(capSeverity(level, 'intermediate').severity).toBe('advisory');
  });
});
