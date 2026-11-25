import { describe, expect, it } from 'vitest';
import {
  MANY_SOURCES,
  researchGateFindings,
  THIN_RESEARCH,
  type ResearchSourceStat,
} from './gate.ts';
import { ResearchNotesSchema, type ResearchNotes } from './notes.ts';

const C1 = 'source-1#chunk-1';
const C2 = 'source-2#chunk-1';

const fact = (n: number) => ({
  id: `fact-${n}`,
  statement: `An invented claim number ${n}.`,
  sourceChunkIds: [C1],
  confidence: 'high' as const,
});

/** Notes that pass every gate-1 rule: enough facts, a number, no disagreement. */
function notes(patch: Partial<ResearchNotes> = {}): ResearchNotes {
  return ResearchNotesSchema.parse({
    mechanism: {
      summary: 'Work waits in a queue and a worker takes the oldest item.',
      sourceChunkIds: [C1],
      steps: [{ text: 'A worker takes the oldest item.', sourceChunkIds: [C1] }],
    },
    plainSummary: 'Jobs wait their turn.',
    analogies: [{ analogy: 'A deli ticket', matches: 'First come.', breaksDown: 'No retries.' }],
    glossary: [{ term: 'Queue', plainMeaning: 'A waiting line.', sourceChunkIds: [C1] }],
    facts: Array.from({ length: THIN_RESEARCH.minFacts }, (_, i) => fact(i + 1)),
    numbers: [{ id: 'num-1', value: '40', unit: 'ms', context: 'Wait', sourceChunkId: C1 }],
    tradeOffs: [],
    rejectedAlternatives: [],
    misconceptions: [],
    failureModes: [],
    hooks: [
      { situation: 'A queue backs up.', sourceChunkIds: [C1] },
      { situation: 'A worker stalls.', sourceChunkIds: [C1] },
    ],
    openQuestions: [],
    ...patch,
  });
}

const source = (sourceId: number, chars: number | null): ResearchSourceStat => ({
  sourceId,
  kind: 'url',
  origin: `https://docs.example.com/${sourceId}`,
  title: null,
  status: chars === null ? 'failed' : 'extracted',
  error: chars === null ? 'HTTP 403' : null,
  errorCode: chars === null ? 'blocked' : null,
  read: chars === null ? null : { chars, chunks: 2, sentChunks: 2 },
});

const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

describe('researchGateFindings', () => {
  it('finds nothing in research that is neither thin nor disputed', () => {
    expect(researchGateFindings(notes(), [source(1, 2_000), source(2, 1_500)])).toEqual({
      blocking: [],
      warnings: [],
    });
  });

  it('blocks thin research: too few facts, no numbers, too little source text', () => {
    const { blocking } = researchGateFindings(notes({ facts: [fact(1), fact(2)], numbers: [] }), [
      source(1, 900),
      source(2, null),
    ]);
    expect(codes(blocking)).toEqual(['research_thin_facts', 'research_no_numbers', 'sources_thin']);
    expect(blocking[0]).toMatchObject({
      path: '$.facts',
      message: expect.stringMatching(/^Only 2 facts \(at least 6 expected\)/) as string,
    });
    expect(blocking[2]!.message).toMatch(
      /^The sources gave 900 characters of text \(about 3,000 expected\)/,
    );
  });

  it('blocks each disagreement between sources, quoting it with its chunks; silence does not block', () => {
    const { blocking } = researchGateFindings(
      notes({
        openQuestions: [
          { question: 'Who covers the gap?', reason: 'not_covered', sourceChunkIds: [] },
          {
            question: 'Should the queue drop or block when full?',
            reason: 'disagreement',
            sourceChunkIds: [C1, C2],
          },
        ],
      }),
      [source(1, 4_000)],
    );
    expect(blocking).toEqual([
      {
        path: '$.openQuestions[1]',
        code: 'sources_disagree',
        message: `The sources disagree: Should the queue drop or block when full? (${C1}, ${C2}). Decide which side the video takes (edit the notes or leave a note), then approve.`,
      },
    ]);
  });

  it(`warns, never blocks, above ${MANY_SOURCES} sources read (failed ones not counted)`, () => {
    const read = Array.from({ length: MANY_SOURCES + 1 }, (_, i) => source(i + 1, 1_000));
    expect(
      researchGateFindings(notes(), [...read.slice(0, MANY_SOURCES), source(9, null)]).warnings,
    ).toEqual([]);
    const { blocking, warnings } = researchGateFindings(notes(), read);
    expect(blocking).toEqual([]);
    expect(codes(warnings)).toEqual(['sources_many']);
  });
});
