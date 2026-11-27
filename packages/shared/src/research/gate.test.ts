import { describe, expect, it } from 'vitest';
import type { DisagreementBlocks } from '../config/settings.ts';
import {
  MANY_SOURCES,
  researchGateFindings as findingsWith,
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
  read:
    chars === null
      ? null
      : {
          chars,
          chunks: 2,
          sentChunks: 2,
          substantiveChars: chars,
          thin: [],
          pointsAtImage: false,
        },
});

/** A source whose text is mostly furniture (run 1's third source, in shape). */
const thinSource = (sourceId: number): ResearchSourceStat => ({
  ...source(sourceId, 511),
  read: {
    chars: 511,
    chunks: 1,
    sentChunks: 1,
    substantiveChars: 367,
    thin: ['points_at_image', 'mostly_boilerplate'],
    pointsAtImage: true,
  },
});

/** The default rule: only disagreements that involve a number block. */
const researchGateFindings = (
  n: ResearchNotes,
  sources: readonly ResearchSourceStat[],
  disagreementBlocks: DisagreementBlocks = 'numbers',
) => findingsWith(n, sources, { disagreementBlocks });

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

  const C3 = 'source-3#chunk-1';
  const disputed = (question: string, sourceChunkIds: string[]) =>
    notes({
      openQuestions: [
        { question: 'Who covers the gap?', reason: 'not_covered', sourceChunkIds: [] },
        { question, reason: 'disagreement', sourceChunkIds },
      ],
    });

  it('blocks a disagreement that cites a chunk behind a research number, naming the number', () => {
    const { blocking, warnings } = researchGateFindings(
      disputed('Should the queue drop or block when full?', [C1, C2]),
      [source(1, 4_000)],
    );
    expect(warnings).toEqual([]);
    expect(blocking).toEqual([
      {
        path: '$.openQuestions[1]',
        code: 'sources_disagree',
        message: `The sources disagree: Should the queue drop or block when full? (${C1}, ${C2}). It involves num-1 = 40. Decide which side the video takes (edit the notes or leave a note), then approve.`,
      },
    ]);
  });

  it('blocks a disagreement whose question states a quantity, in digits or in words', () => {
    for (const question of [
      'Is the wait 40 ms or more?',
      'Do workers take twenty items or fewer?',
    ]) {
      const { blocking } = researchGateFindings(disputed(question, [C3]), [source(1, 4_000)]);
      expect(codes(blocking)).toEqual(['sources_disagree']);
    }
    const { blocking } = researchGateFindings(disputed('Is the wait 40 ms or more?', []), [
      source(1, 4_000),
    ]);
    expect(blocking[0]!.message).toContain('It involves "40".');
  });

  it('leaves a disagreement with no number in its text or its chunks as an advisory note', () => {
    for (const question of [
      'Should the queue drop or block when full?',
      'Do two or three workers share it?',
      'Is HTTP 429 or p99 the signal?',
    ]) {
      const { blocking, warnings } = researchGateFindings(disputed(question, [C3]), [
        source(1, 4_000),
      ]);
      expect(blocking).toEqual([]);
      expect(warnings).toEqual([
        {
          path: '$.openQuestions[1]',
          code: 'sources_disagree',
          message: `The sources disagree (no number involved, so it does not block): ${question} (${C3}). Check which side the notes take.`,
        },
      ]);
    }
  });

  it('blocks every disagreement with "all" and none with "none"; silence never blocks', () => {
    const plain = disputed('Should the queue drop or block when full?', [C3]);
    const numeric = disputed('Should the queue drop or block when full?', [C1]);
    expect(codes(researchGateFindings(plain, [source(1, 4_000)], 'all').blocking)).toEqual([
      'sources_disagree',
    ]);
    const none = researchGateFindings(numeric, [source(1, 4_000)], 'none');
    expect(none.blocking).toEqual([]);
    expect(none.warnings).toEqual([
      expect.objectContaining({
        code: 'sources_disagree',
        message: `The sources disagree: Should the queue drop or block when full? (${C1}). Check which side the notes take.`,
      }),
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

describe('source_thin', () => {
  it('warns per thin source, naming why, what to do and what rests only on it', () => {
    const n = notes({
      facts: [
        { ...fact(1), sourceChunkIds: [C2] },
        { ...fact(2), sourceChunkIds: [C1, C2] },
        ...[3, 4, 5, 6, 7].map(fact),
      ],
      numbers: [
        { id: 'num-1', value: '40', unit: 'ms', context: 'Wait', sourceChunkId: C1 },
        { id: 'num-2', value: '1000', unit: 'times', context: 'Faster', sourceChunkId: C2 },
      ],
    });
    const { warnings, blocking } = researchGateFindings(n, [source(1, 9_000), thinSource(2)]);
    expect(codes(blocking)).toEqual([]);
    expect(warnings).toEqual([
      {
        path: '$.sources[1]',
        code: 'source_thin',
        message:
          'Source 2: https://docs.example.com/2 gave only 367 characters of content (511 ' +
          'extracted): its text points at a diagram or image it does not contain; much of it is ' +
          'links or site boilerplate. To use what it says, paste its text, or describe the ' +
          'diagram, as a source instead. Resting only on thin sources: fact-1, num-2.',
      },
    ]);
  });

  it('says nothing about pasted text or an upload, however short', () => {
    const pasted = { ...thinSource(2), kind: 'text' as const };
    expect(codes(researchGateFindings(notes(), [source(1, 9_000), pasted]).warnings)).toEqual([]);
  });

  it('says nothing about a source that is not thin, or one it could not read', () => {
    const { warnings } = researchGateFindings(notes(), [source(1, 9_000), source(2, null)]);
    expect(codes(warnings)).toEqual([]);
  });
});

describe('researcher@v4: numberIds and the angle', () => {
  const q = (patch: Partial<ResearchNotes['openQuestions'][number]>) => ({
    question: 'Fail open or fail closed?',
    reason: 'disagreement' as const,
    sourceChunkIds: [C1],
    ...patch,
  });

  it('a disagreement blocks by the numbers it names, not by a number sharing its chunk', () => {
    const choice = researchGateFindings(notes({ openQuestions: [q({ numberIds: [] })] }), [
      source(1, 9_000),
    ]);
    expect(codes(choice.blocking)).toEqual([]);
    expect(codes(choice.warnings)).toEqual(['sources_disagree']);
    const quantity = researchGateFindings(notes({ openQuestions: [q({ numberIds: ['num-1'] })] }), [
      source(1, 9_000),
    ]);
    expect(quantity.blocking[0]?.message).toContain('It involves num-1 = 40.');
    // Notes from before v4 (no numberIds) keep the chunk rule: num-1 comes from C1.
    const old = researchGateFindings(notes({ openQuestions: [q({})] }), [source(1, 9_000)]);
    expect(codes(old.blocking)).toEqual(['sources_disagree']);
  });

  it('warns first when the sources do not cover the angle itself', () => {
    const uncovered = (angle: 'serves' | 'off') =>
      researchGateFindings(
        notes({
          openQuestions: [
            {
              question: 'How does the loop pick the next item?',
              reason: 'not_covered',
              sourceChunkIds: [],
              angle,
            },
          ],
        }),
        [source(1, 9_000)],
      ).warnings;
    expect(uncovered('serves')).toEqual([
      {
        path: '$.openQuestions[0]',
        code: 'angle_not_covered',
        message:
          'The sources do not cover what the angle needs: How does the loop pick the next item? ' +
          'Add a source that does before planning, or the plan will fill the gap from other material.',
      },
    ]);
    expect(uncovered('off')).toEqual([]);
  });
});
