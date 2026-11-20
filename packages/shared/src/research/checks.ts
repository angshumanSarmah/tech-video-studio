import { toJsonPath, type SpecError } from '../spec/validate.ts';
import { parseSourceChunkId } from '../domain/sources.ts';
import {
  foldText,
  normalizeNumber,
  numberSet,
  numberWordTokens,
  quantityTokens,
} from './numbers.ts';

/** A problem in research notes at a JSON path, in the spec validator's shape. */
export type ResearchIssue = SpecError;

export const RESEARCH_ISSUE_CODES = [
  'unknown_chunk',
  'number_not_in_source',
  'unsourced_number',
  'duplicate_id',
] as const;
export type ResearchIssueCode = (typeof RESEARCH_ISSUE_CODES)[number];

/** A chunk the notes may cite: its id and text. */
export interface CitableChunk {
  readonly id: string;
  readonly text: string;
}

interface ChunkIndex {
  readonly folded: string;
  readonly numbers: ReadonlySet<string>;
}

type Path = readonly (string | number)[];
type JsonObject = Readonly<Record<string, unknown>>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Keys the walk skips: ids, citations, `value` (checked by `numberValueIssues`) and
 * `plainSummary` (checked by `plainSummaryIssues`).
 */
const NOT_PROSE = new Set(['id', 'sourceChunkIds', 'sourceChunkId', 'value', 'plainSummary']);

/**
 * Deterministic checks on research notes against the chunks the Researcher was given (P1C.3):
 * - `unknown_chunk`: a citation that is not one of those chunks;
 * - `number_not_in_source`: a `numbers[]` value its cited chunk does not state;
 * - `unsourced_number`: a quantity in any text that none of the item's cited chunks states
 *   (identifiers such as `IPv4` or `p99` are skipped: `quantityTokens`). Texts that cite
 *   nothing (analogies, open questions without chunks) may carry no number, in digits or in
 *   words ("one", "two" and "three" excepted: `numberWordTokens`); `plainSummary` may reuse a
 *   number listed in `numbers[]` and no other; a number's `asOf` and an incident's `date` may
 *   come from any chunk of the cited source (a report's date sits in its header, not next to
 *   every number);
 * - `duplicate_id`: two facts or two numbers with one id.
 * Agent output repairs these; gate edits and imports run the same check. It accepts any JSON
 * value and checks what it can find, so the LLM client can run it on an answer that still fails
 * the schema and send every problem in one repair.
 */
export function researchNotesProblems(
  notes: unknown,
  chunks: Iterable<CitableChunk>,
): ResearchIssue[] {
  const index = new Map<string, ChunkIndex>();
  for (const chunk of chunks) {
    index.set(chunk.id, { folded: foldText(chunk.text), numbers: numberSet(chunk.text) });
  }
  const root = asObject(notes);
  if (!root) return [];
  const numbers = asList(root.numbers);
  return [
    ...walkIssues(root, [], [], index),
    ...analogyWordIssues(asList(root.analogies)),
    ...openQuestionWordIssues(asList(root.openQuestions)),
    ...plainSummaryIssues(asString(root.plainSummary), numbers),
    ...numbers.flatMap((n, i) => numberValueIssues(n, ['numbers', i, 'value'], index)),
    ...duplicateIds(asList(root.facts), 'facts'),
    ...duplicateIds(numbers, 'numbers'),
  ];
}

function issue(path: Path, code: ResearchIssueCode, message: string): ResearchIssue {
  return { path: toJsonPath(path), code, message };
}

function ownCitations(value: object): readonly string[] | null {
  if ('sourceChunkIds' in value && Array.isArray(value.sourceChunkIds)) {
    return value.sourceChunkIds.filter((id): id is string => typeof id === 'string');
  }
  if ('sourceChunkId' in value && typeof value.sourceChunkId === 'string') {
    return [value.sourceChunkId];
  }
  return null;
}

/** Walks the notes; each string is checked against the citations of its nearest cited item. */
function walkIssues(
  value: unknown,
  path: Path,
  cited: readonly string[],
  index: ReadonlyMap<string, ChunkIndex>,
): ResearchIssue[] {
  if (typeof value === 'string') return proseIssues(value, path, cited, index);
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => walkIssues(item, [...path, i], cited, index));
  }
  if (value === null || typeof value !== 'object') return [];
  const own = ownCitations(value);
  const issues = own ? citationIssues(value, path, index) : [];
  const scope = own ?? cited;
  for (const [key, child] of Object.entries(value)) {
    if (NOT_PROSE.has(key)) continue;
    const childScope = isSourceDate(path, key) ? sameSourceChunks(scope, index) : scope;
    issues.push(...walkIssues(child, [...path, key], childScope, index));
  }
  return issues;
}

/** Dates checked against the whole cited source: `numbers[].asOf`, `failureModes[].incident.date`. */
function isSourceDate(path: Path, key: string): boolean {
  return key === 'asOf' || (key === 'date' && path.at(-1) === 'incident');
}

/** Every input chunk of the sources the given chunks belong to, in input order. */
function sameSourceChunks(
  cited: readonly string[],
  index: ReadonlyMap<string, ChunkIndex>,
): readonly string[] {
  const sources = new Set(cited.map((id) => parseSourceChunkId(id)?.sourceId));
  return [...index.keys()].filter((id) => sources.has(parseSourceChunkId(id)?.sourceId));
}

function citationIssues(
  value: object,
  path: Path,
  index: ReadonlyMap<string, ChunkIndex>,
): ResearchIssue[] {
  if ('sourceChunkId' in value && typeof value.sourceChunkId === 'string') {
    return unknownChunk(value.sourceChunkId, [...path, 'sourceChunkId'], index);
  }
  const ids =
    'sourceChunkIds' in value && Array.isArray(value.sourceChunkIds) ? value.sourceChunkIds : [];
  return ids.flatMap((id: unknown, i) =>
    typeof id === 'string' ? unknownChunk(id, [...path, 'sourceChunkIds', i], index) : [],
  );
}

function unknownChunk(
  id: string,
  path: Path,
  index: ReadonlyMap<string, ChunkIndex>,
): ResearchIssue[] {
  if (index.has(id)) return [];
  return [
    issue(
      path,
      'unknown_chunk',
      `"${id}" is not a chunk in the input. Cite only the chunk ids given.`,
    ),
  ];
}

function proseIssues(
  text: string,
  path: Path,
  cited: readonly string[],
  index: ReadonlyMap<string, ChunkIndex>,
): ResearchIssue[] {
  const stated = cited.flatMap((id) => {
    const chunk = index.get(id);
    return chunk ? [chunk.numbers] : [];
  });
  const missing = quantityTokens(text).filter(
    (token) => !stated.some((numbers) => numbers.has(normalizeNumber(token))),
  );
  return [...new Set(missing)].map((token) =>
    issue(
      path,
      'unsourced_number',
      cited.length === 0
        ? `"${token}" has no source here: this text cites no chunk, so it cannot carry a number. Remove it, or put it in an item that cites the chunk that states it.`
        : `"${token}" is not in the cited chunks (${cited.join(', ')}). Cite the chunk that states it, or remove the number.`,
    ),
  );
}

/** Analogies cite nothing, so they carry no number in words either ("Twenty-four tills"). */
function analogyWordIssues(analogies: readonly unknown[]): ResearchIssue[] {
  return analogies.flatMap((analogy, i) =>
    Object.entries(asObject(analogy) ?? {}).flatMap(([key, text]) =>
      numberWordIssues(asString(text), ['analogies', i, key], 'Analogies'),
    ),
  );
}

/** An open question that cites nothing carries no number in words either. */
function openQuestionWordIssues(questions: readonly unknown[]): ResearchIssue[] {
  return questions.flatMap((question, i) => {
    const item = asObject(question);
    if (!item || (ownCitations(item)?.length ?? 0) > 0) return [];
    return numberWordIssues(
      asString(item.question),
      ['openQuestions', i, 'question'],
      'Open questions that cite no chunk',
    );
  });
}

function numberWordIssues(text: string | null, path: Path, subject: string): ResearchIssue[] {
  return [...new Set(numberWordTokens(text ?? ''))].map((word) =>
    issue(
      path,
      'unsourced_number',
      `"${word}" is a number written as a word. ${subject} carry no numbers, in digits or words ("one", "two" and "three" are fine): describe the idea without the count.`,
    ),
  );
}

/**
 * The plain summary cites nothing, so it may only reuse numbers already listed in `numbers[]`
 * (each sourced there), compared by the same tokens as `number_not_in_source`.
 */
function plainSummaryIssues(
  plainSummary: string | null,
  numbers: readonly unknown[],
): ResearchIssue[] {
  if (plainSummary === null) return [];
  const listed = new Set(
    numbers.flatMap((n) => quantityTokens(asString(asObject(n)?.value) ?? '').map(normalizeNumber)),
  );
  const missing = quantityTokens(plainSummary).filter(
    (token) => !listed.has(normalizeNumber(token)),
  );
  return [...new Set(missing)].map((token) =>
    issue(
      ['plainSummary'],
      'unsourced_number',
      `"${token}" is not a value in "numbers". The plain summary may only reuse listed numbers: add it to "numbers" with its source chunk, or remove it.`,
    ),
  );
}

function numberValueIssues(
  number: unknown,
  path: Path,
  index: ReadonlyMap<string, ChunkIndex>,
): ResearchIssue[] {
  const value = asString(asObject(number)?.value);
  const chunkId = asString(asObject(number)?.sourceChunkId);
  const chunk = chunkId === null ? undefined : index.get(chunkId);
  if (value === null || !chunk) return []; // a schema error, or reported as unknown_chunk
  const tokens = quantityTokens(value);
  const stated =
    tokens.length > 0
      ? tokens.every((token) => chunk.numbers.has(normalizeNumber(token)))
      : chunk.folded.includes(foldText(value));
  if (stated) return [];
  return [
    issue(
      path,
      'number_not_in_source',
      `"${value}" is not in ${chunkId}. Write the value exactly as that chunk does, or cite the chunk that states it.`,
    ),
  ];
}

function duplicateIds(items: readonly unknown[], list: string): ResearchIssue[] {
  const seen = new Set<string>();
  const issues: ResearchIssue[] = [];
  for (const [i, item] of items.entries()) {
    const id = asString(asObject(item)?.id);
    if (id === null) continue;
    if (seen.has(id)) {
      issues.push(issue([list, i, 'id'], 'duplicate_id', `"${id}" is used twice in ${list}.`));
    }
    seen.add(id);
  }
  return issues;
}
