import { toJsonPath, type SpecError } from '../spec/validate.ts';
import type { ResearchNotes } from './notes.ts';
import { foldText, normalizeNumber, numberSet, quantityTokens } from './numbers.ts';

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
 *   nothing (analogies, open questions without chunks) may carry no number; `plainSummary`
 *   may reuse a number listed in `numbers[]` and no other;
 * - `duplicate_id`: two facts or two numbers with one id.
 * Agent output repairs these; gate edits and imports run the same check.
 */
export function researchNotesProblems(
  notes: ResearchNotes,
  chunks: Iterable<CitableChunk>,
): ResearchIssue[] {
  const index = new Map<string, ChunkIndex>();
  for (const chunk of chunks) {
    index.set(chunk.id, { folded: foldText(chunk.text), numbers: numberSet(chunk.text) });
  }
  return [
    ...walkIssues(notes, [], [], index),
    ...plainSummaryIssues(notes),
    ...notes.numbers.flatMap((n, i) => numberValueIssues(n, ['numbers', i, 'value'], index)),
    ...duplicateIds(notes.facts, 'facts'),
    ...duplicateIds(notes.numbers, 'numbers'),
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
    issues.push(...walkIssues(child, [...path, key], scope, index));
  }
  return issues;
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

/**
 * The plain summary cites nothing, so it may only reuse numbers already listed in `numbers[]`
 * (each sourced there), compared by the same tokens as `number_not_in_source`.
 */
function plainSummaryIssues(notes: ResearchNotes): ResearchIssue[] {
  const listed = new Set(
    notes.numbers.flatMap((n) => quantityTokens(n.value).map(normalizeNumber)),
  );
  const missing = quantityTokens(notes.plainSummary).filter(
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
  number: ResearchNotes['numbers'][number],
  path: Path,
  index: ReadonlyMap<string, ChunkIndex>,
): ResearchIssue[] {
  const chunk = index.get(number.sourceChunkId);
  if (!chunk) return []; // reported as unknown_chunk
  const tokens = quantityTokens(number.value);
  const stated =
    tokens.length > 0
      ? tokens.every((token) => chunk.numbers.has(normalizeNumber(token)))
      : chunk.folded.includes(foldText(number.value));
  if (stated) return [];
  return [
    issue(
      path,
      'number_not_in_source',
      `"${number.value}" is not in ${number.sourceChunkId}. Write the value exactly as that chunk does, or cite the chunk that states it.`,
    ),
  ];
}

function duplicateIds(items: readonly { id: string }[], list: string): ResearchIssue[] {
  const seen = new Set<string>();
  const issues: ResearchIssue[] = [];
  for (const [i, item] of items.entries()) {
    if (seen.has(item.id)) {
      issues.push(issue([list, i, 'id'], 'duplicate_id', `"${item.id}" is used twice in ${list}.`));
    }
    seen.add(item.id);
  }
  return issues;
}
