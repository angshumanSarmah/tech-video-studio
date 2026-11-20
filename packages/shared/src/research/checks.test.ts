import { describe, expect, it } from 'vitest';
import { researchNotesProblems, type CitableChunk } from './checks.ts';
import { ResearchNotesSchema, type ResearchNotes } from './notes.ts';

const C1 = 'source-1#chunk-1';
const C2 = 'source-2#chunk-1';

/** Invented chunk text. */
const CHUNKS: CitableChunk[] = [
  {
    id: C1,
    text: 'A bucket holds 100 tokens and refills 10 per second. Over IPv4 or HTTP/2, an empty bucket answers 429. Measured in June 2024 at p99: 2.1 ms.',
  },
  {
    id: C2,
    text: 'A log of 1,000 requests costs about 8 KB per key. One million keys is a lot.',
  },
];

function notes(patch: Partial<ResearchNotes> = {}): ResearchNotes {
  return ResearchNotesSchema.parse({
    mechanism: {
      summary: 'Each request takes one token; an empty bucket answers 429.',
      sourceChunkIds: [C1],
      steps: [{ text: 'Refill 10 tokens per second, up to 100.', sourceChunkIds: [C1] }],
    },
    facts: [
      {
        id: 'fact-1',
        statement: 'Over IPv4 or HTTP/2, p99 is 2.1 ms.',
        sourceChunkIds: [C1],
        confidence: 'high',
      },
    ],
    numbers: [
      {
        id: 'num-1',
        value: '1,000',
        unit: 'requests',
        context: 'Log size for 8 KB',
        sourceChunkId: C2,
      },
      { id: 'num-2', value: 'One million', unit: 'keys', context: 'Key count', sourceChunkId: C2 },
      {
        id: 'num-3',
        value: '2.1',
        unit: 'ms',
        context: 'p99 latency',
        sourceChunkId: C1,
        asOf: 'June 2024',
      },
    ],
    tradeOffs: [],
    rejectedAlternatives: [],
    misconceptions: [],
    failureModes: [],
    hooks: [
      { situation: '100 tokens, then 429.', sourceChunkIds: [C1] },
      { situation: '1000 requests cost 8 KB per key.', sourceChunkIds: [C2] },
    ],
    openQuestions: [
      { question: 'What do paid tiers get?', reason: 'not_covered', sourceChunkIds: [] },
    ],
    ...patch,
  });
}

describe('researchNotesProblems', () => {
  it('passes notes whose every number is in its cited chunks (identifiers skipped)', () => {
    expect(researchNotesProblems(notes(), CHUNKS)).toEqual([]);
  });

  it('flags a quantity that is not in the item’s own cited chunks', () => {
    const problems = researchNotesProblems(
      notes({
        facts: [
          {
            id: 'fact-1',
            statement: 'A bucket holds 100 tokens and costs 8 KB.',
            sourceChunkIds: [C1],
            confidence: 'high',
          },
        ],
      }),
      CHUNKS,
    );
    expect(problems).toEqual([
      {
        path: '$.facts[0].statement',
        code: 'unsourced_number',
        message: expect.stringContaining(
          '"8" is not in the cited chunks (source-1#chunk-1)',
        ) as string,
      },
    ]);
  });

  it.each([
    ['a status code', 'Retries after 503.', '503'],
    ['a year', 'Since the 2018 redesign.', '2018'],
    ['a grouped number', 'Up to 10,000 keys.', '10,000'],
    ['a duration', 'Within 50 ms.', '50'],
  ])('flags %s that no chunk states', (_what, statement, token) => {
    const problems = researchNotesProblems(
      notes({ facts: [{ id: 'fact-1', statement, sourceChunkIds: [C1, C2], confidence: 'low' }] }),
      CHUNKS,
    );
    expect(problems.map((p) => [p.code, p.message.split(' ')[0]])).toEqual([
      ['unsourced_number', `"${token}"`],
    ]);
  });

  it('does not flag identifiers that look like numbers', () => {
    const statement = 'SHA-256 keys over IPv4, an L7 proxy, O(log n) and O(1) lookups at p99.';
    const problems = researchNotesProblems(
      notes({ facts: [{ id: 'fact-1', statement, sourceChunkIds: [C2], confidence: 'low' }] }),
      CHUNKS,
    );
    expect(problems).toEqual([]);
  });

  it('flags a number in an open question that cites nothing', () => {
    const problems = researchNotesProblems(
      notes({
        openQuestions: [
          { question: 'Is 100 enough for paid tiers?', reason: 'not_covered', sourceChunkIds: [] },
        ],
      }),
      CHUNKS,
    );
    expect(problems).toEqual([
      {
        path: '$.openQuestions[0].question',
        code: 'unsourced_number',
        message: expect.stringContaining('this item cites no chunk') as string,
      },
    ]);
  });

  it('checks a number’s value, context and date against its one chunk', () => {
    const base = notes().numbers;
    const problems = researchNotesProblems(
      notes({
        numbers: [
          { ...base[0]!, value: '1,200' },
          { ...base[1]!, value: 'two million' },
          { ...base[2]!, asOf: 'June 2023', context: 'p99 latency on 24 nodes' },
        ],
      }),
      CHUNKS,
    );
    expect(problems.map((p) => [p.path, p.code])).toEqual([
      ['$.numbers[2].context', 'unsourced_number'],
      ['$.numbers[2].asOf', 'unsourced_number'],
      ['$.numbers[0].value', 'number_not_in_source'],
      ['$.numbers[1].value', 'number_not_in_source'],
    ]);
  });

  it('flags citations of chunks that were not in the input', () => {
    const problems = researchNotesProblems(
      notes({
        hooks: [
          { situation: 'A bucket of tokens.', sourceChunkIds: [C1, 'source-9#chunk-1'] },
          { situation: 'A log per key.', sourceChunkIds: [C2] },
        ],
      }),
      CHUNKS,
    );
    expect(problems).toEqual([
      {
        path: '$.hooks[0].sourceChunkIds[1]',
        code: 'unknown_chunk',
        message: expect.stringContaining(
          '"source-9#chunk-1" is not a chunk in the input',
        ) as string,
      },
    ]);
  });

  it('flags duplicate fact and number ids', () => {
    const fact = notes().facts[0]!;
    const number = notes().numbers[0]!;
    const problems = researchNotesProblems(
      notes({ facts: [fact, fact], numbers: [number, number] }),
      CHUNKS,
    );
    expect(problems.map((p) => [p.path, p.code])).toEqual([
      ['$.facts[1].id', 'duplicate_id'],
      ['$.numbers[1].id', 'duplicate_id'],
    ]);
  });
});
