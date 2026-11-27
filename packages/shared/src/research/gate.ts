import { z } from 'zod';
import type { DisagreementBlocks } from '../config/settings.ts';
import { SourceKindSchema, SourceStatusSchema } from '../domain/library.ts';
import { SourceFailureCodeSchema } from '../domain/sources.ts';
import type { SpecError } from '../spec/validate.ts';
import type { ResearchNotes } from './notes.ts';
import { numberWordTokens, quantityTokens } from './numbers.ts';
import { SOURCE_THIN_REASONS, thinSourceMessage } from './source-quality.ts';

/**
 * Gate 1's own rules (P1C.9 step 9), on top of the notes' checks: thin research and sources that
 * disagree (by default only on a number: `settings.research.disagreementBlocks`) stop the gate
 * from approving itself, so a person reads the notes first. Other disagreements and many sources
 * only warn. Pure: the orchestrator (auto-approve) and the gate view (shown at the top) share it.
 */

/** Below any of these the research is thin. */
export const THIN_RESEARCH = {
  /** Facts in the notes. */
  minFacts: 6,
  /** Numbers in the notes. */
  minNumbers: 1,
  /** Characters of text extracted from the sources the Researcher read (pinned versions). */
  minSourceChars: 3_000,
} as const;

/** More sources than this share one token budget thinly: a warning, never a block. */
export const MANY_SOURCES = 5;

/** One source as gate 1 shows it: where it came from, how much text it gave, what failed. */
export const ResearchSourceStatSchema = z.object({
  sourceId: z.number().int().positive(),
  kind: SourceKindSchema,
  /** The URL, the uploaded file's name, or the pasted text's title. */
  origin: z.string().min(1),
  title: z.string().nullable(),
  status: SourceStatusSchema,
  /** Why it failed (a source the run could not use). */
  error: z.string().nullable(),
  errorCode: SourceFailureCodeSchema.nullable(),
  /**
   * The Researcher read this source: its version's characters, chunks, and chunks sent; the
   * characters left once links and boilerplate are dropped, and why it is thin (empty: it is not;
   * `sourceQuality`).
   */
  read: z
    .object({
      chars: z.number().int().nonnegative(),
      chunks: z.number().int().nonnegative(),
      sentChunks: z.number().int().nonnegative(),
      substantiveChars: z.number().int().nonnegative(),
      thin: z.array(z.enum(SOURCE_THIN_REASONS)),
      pointsAtImage: z.boolean(),
    })
    .nullable(),
});
export type ResearchSourceStat = z.infer<typeof ResearchSourceStatSchema>;

export const RESEARCH_GATE_CODES = [
  'research_thin_facts',
  'research_no_numbers',
  'sources_thin',
  'sources_disagree',
  'sources_many',
  'source_thin',
  'angle_not_covered',
] as const;

export interface ResearchGateFindings {
  /** Each stops auto-approve. */
  readonly blocking: SpecError[];
  /** Shown, never blocking. */
  readonly warnings: SpecError[];
}

export interface ResearchGateOptions {
  /** Which disagreements block (`settings.research.disagreementBlocks`). */
  readonly disagreementBlocks: DisagreementBlocks;
}

export function researchGateFindings(
  notes: ResearchNotes,
  sources: readonly ResearchSourceStat[],
  options: ResearchGateOptions,
): ResearchGateFindings {
  const disputes = disagreements(notes, options.disagreementBlocks);
  return {
    blocking: [...thinResearch(notes, sources), ...disputes.blocking],
    warnings: [
      ...angleNotCovered(notes),
      ...disputes.advisory,
      ...manySources(sources),
      ...thinSources(notes, sources),
    ],
  };
}

function thinResearch(notes: ResearchNotes, sources: readonly ResearchSourceStat[]): SpecError[] {
  const issues: SpecError[] = [];
  const thin =
    'the research is thin: add sources (or paste your own notes) and regenerate, or approve';
  if (notes.facts.length < THIN_RESEARCH.minFacts) {
    issues.push({
      path: '$.facts',
      code: 'research_thin_facts',
      message: `Only ${notes.facts.length} facts (at least ${THIN_RESEARCH.minFacts} expected): ${thin} if the topic is that small.`,
    });
  }
  if (notes.numbers.length < THIN_RESEARCH.minNumbers) {
    issues.push({
      path: '$.numbers',
      code: 'research_no_numbers',
      message: `No numbers in the notes, so the hook has none to state: ${thin} without them.`,
    });
  }
  const chars = sourceChars(sources);
  if (chars < THIN_RESEARCH.minSourceChars) {
    issues.push({
      path: '$',
      code: 'sources_thin',
      message: `The sources gave ${chars.toLocaleString('en-US')} characters of text (about ${THIN_RESEARCH.minSourceChars.toLocaleString('en-US')} expected): ${thin} if they cover the topic.`,
    });
  }
  return issues;
}

/** Characters of every source the Researcher read. */
export function sourceChars(sources: readonly ResearchSourceStat[]): number {
  return sources.reduce((sum, s) => sum + (s.read?.chars ?? 0), 0);
}

type OpenQuestion = ResearchNotes['openQuestions'][number];

/** Each disagreement between sources, blocking or advisory as `mode` says. */
function disagreements(
  notes: ResearchNotes,
  mode: DisagreementBlocks,
): { blocking: SpecError[]; advisory: SpecError[] } {
  const blocking: SpecError[] = [];
  const advisory: SpecError[] = [];
  notes.openQuestions.forEach((q, i) => {
    if (q.reason !== 'disagreement') return;
    const numbers = questionNumbers(q, notes);
    const blocks = mode === 'all' || (mode === 'numbers' && numbers.length > 0);
    const issue = { path: `$.openQuestions[${i}]`, code: 'sources_disagree' };
    if (blocks) blocking.push({ ...issue, message: blockingMessage(q, numbers) });
    else advisory.push({ ...issue, message: advisoryMessage(q, numbers) });
  });
  return { blocking, advisory };
}

/**
 * The numbers a disagreement is about: its `numberIds` (researcher@v4: the Researcher names them;
 * empty when the sources disagree about a choice), else, for notes from before v4, the chunk rule
 * (`disputedNumbers`).
 */
function questionNumbers(q: OpenQuestion, notes: ResearchNotes): string[] {
  if (q.numberIds === undefined) return disputedNumbers(q, notes);
  return q.numberIds.map((id) => {
    const n = notes.numbers.find((x) => x.id === id);
    return n ? `${id} = ${n.value}` : id;
  });
}

/**
 * For notes from before v4: what makes a disagreement one about numbers: the quantities its question states (identifiers
 * and everyday "one" to "three" aside, as in the Researcher's check), then the research numbers
 * (`num-<n> = <value>`) that come from a chunk it cites. Empty when it involves none.
 */
export function disputedNumbers(question: OpenQuestion, notes: ResearchNotes): string[] {
  const stated = [...quantityTokens(question.question), ...numberWordTokens(question.question)];
  const cited = new Set(question.sourceChunkIds);
  const behind = notes.numbers
    .filter((n) => cited.has(n.sourceChunkId))
    .map((n) => `${n.id} = ${n.value}`);
  return [...stated.map((t) => `"${t}"`), ...behind];
}

function blockingMessage(q: OpenQuestion, numbers: readonly string[]): string {
  const involves = numbers.length > 0 ? ` It involves ${numbers.join(', ')}.` : '';
  return `The sources disagree: ${q.question}${citing(q.sourceChunkIds)}.${involves} Decide which side the video takes (edit the notes or leave a note), then approve.`;
}

function advisoryMessage(q: OpenQuestion, numbers: readonly string[]): string {
  const why = numbers.length > 0 ? '' : ' (no number involved, so it does not block)';
  return `The sources disagree${why}: ${q.question}${citing(q.sourceChunkIds)}. Check which side the notes take.`;
}

const citing = (ids: readonly string[]) => (ids.length > 0 ? ` (${ids.join(', ')})` : '');

function manySources(sources: readonly ResearchSourceStat[]): SpecError[] {
  const read = sources.filter((s) => s.read !== null).length;
  if (read <= MANY_SOURCES) return [];
  return [
    {
      path: '$',
      code: 'sources_many',
      message: `${read} sources share one research budget (more than ${MANY_SOURCES}): each gets less of its text read. Check the left-out chunks, or drop the weakest sources.`,
    },
  ];
}

/**
 * `source_thin`, one warning per thin fetched page the Researcher read (`sourceQuality`): what it gave,
 * why it is thin, what to do, and the facts and numbers that cite only it (or only thin
 * sources), so a person sees what rests on it before planning.
 */
function thinSources(notes: ResearchNotes, sources: readonly ResearchSourceStat[]): SpecError[] {
  // Fetched pages only: pasted text and uploads are what the person chose to give.
  const thin = sources.filter((s) => s.kind === 'url' && s.read && s.read.thin.length > 0);
  const thinIds = new Set(thin.map((s) => s.sourceId));
  const restsOnThin = (chunkIds: readonly string[]) =>
    chunkIds.length > 0 && chunkIds.every((id) => thinIds.has(sourceIdOfChunk(id)));
  const resting = (sourceId: number) => [
    ...notes.facts
      .filter((f) => restsOnThin(f.sourceChunkIds) && citesSource(f.sourceChunkIds, sourceId))
      .map((f) => f.id),
    ...notes.numbers
      .filter(
        (n) => restsOnThin([n.sourceChunkId]) && sourceIdOfChunk(n.sourceChunkId) === sourceId,
      )
      .map((n) => n.id),
  ];
  return thin.map((s) => {
    const ids = resting(s.sourceId);
    const rest = ids.length > 0 ? ` Resting only on thin sources: ${ids.join(', ')}.` : '';
    return {
      path: `$.sources[${sources.indexOf(s)}]`,
      code: 'source_thin',
      message: `Source ${s.sourceId}: ${thinSourceMessage(s.origin, s.read!)}${rest}`,
    };
  });
}

/** `source-3#chunk-1` → 3 (`sourceChunkId`'s format); NaN for anything else. */
function sourceIdOfChunk(chunkId: string): number {
  const match = /^source-(\d+)#chunk-\d+$/.exec(chunkId);
  return match ? Number(match[1]) : Number.NaN;
}

const citesSource = (chunkIds: readonly string[], sourceId: number) =>
  chunkIds.some((id) => sourceIdOfChunk(id) === sourceId);

/**
 * `angle_not_covered`: a `not_covered` open question the Researcher marked `serves` is about the
 * run's angle itself (run 1: how the event loop works beyond IO multiplexing, on a video about
 * why one thread is fast). Shown first at gate 1, so a source is added before planning; it never
 * blocks.
 */
function angleNotCovered(notes: ResearchNotes): SpecError[] {
  return notes.openQuestions.flatMap((q, i) =>
    q.reason === 'not_covered' && q.angle === 'serves'
      ? [
          {
            path: `$.openQuestions[${i}]`,
            code: 'angle_not_covered',
            message:
              `The sources do not cover what the angle needs: ${q.question} Add a source that ` +
              'does before planning, or the plan will fill the gap from other material.',
          },
        ]
      : [],
  );
}
