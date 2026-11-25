import { z } from 'zod';
import { SourceKindSchema, SourceStatusSchema } from '../domain/library.ts';
import { SourceFailureCodeSchema } from '../domain/sources.ts';
import type { SpecError } from '../spec/validate.ts';
import type { ResearchNotes } from './notes.ts';

/**
 * Gate 1's own rules (P1C.9 step 9), on top of the notes' checks: thin research and sources that
 * disagree stop the gate from approving itself, so a person reads the notes first. Many sources
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
  /** The Researcher read this source: its version's characters, chunks, and chunks sent. */
  read: z
    .object({
      chars: z.number().int().nonnegative(),
      chunks: z.number().int().nonnegative(),
      sentChunks: z.number().int().nonnegative(),
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
] as const;

export interface ResearchGateFindings {
  /** Each stops auto-approve. */
  readonly blocking: SpecError[];
  /** Shown, never blocking. */
  readonly warnings: SpecError[];
}

export function researchGateFindings(
  notes: ResearchNotes,
  sources: readonly ResearchSourceStat[],
): ResearchGateFindings {
  return {
    blocking: [...thinResearch(notes, sources), ...disagreements(notes)],
    warnings: manySources(sources),
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

function disagreements(notes: ResearchNotes): SpecError[] {
  return notes.openQuestions.flatMap((q, i) =>
    q.reason === 'disagreement'
      ? [
          {
            path: `$.openQuestions[${i}]`,
            code: 'sources_disagree',
            message: `The sources disagree: ${q.question}${citing(q.sourceChunkIds)}. Decide which side the video takes (edit the notes or leave a note), then approve.`,
          },
        ]
      : [],
  );
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
