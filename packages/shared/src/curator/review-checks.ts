import type { ResearchNotes } from '../research/notes.ts';
import { numberIndex } from '../script/note-values.ts';
import { numberKey, numberMentions } from '../script/number-mentions.ts';
import {
  CATEGORY_RULES,
  FIELD_OWNERS,
  FIX_FIELDS,
  REVIEW_CATEGORIES,
  SHOWN_KINDS,
  type FixField,
  type ReviewCategory,
} from './review.ts';
import { CURATOR_OWNERS, type CuratorOwner } from './issue.ts';
import { isRecord, problem, text, type Json, type Path } from './review-helpers.ts';

/**
 * Keeping the review honest (P1C.8): every issue's evidence must be in the input it quotes, so a
 * claim about the video can be checked by code before anyone acts on it. Runs as `callJson`'s
 * `check`, so it takes any JSON value (it also runs on answers that fail the schema) and a
 * failure is sent back for repair; an issue still unverified after the repairs is dropped by the
 * caller. Pure. It checks:
 * - the beat exists; each quote is in that beat's narration, headline, tags, stat cards, source
 *   line or (with its `elementId`) a board element's texts; a fact or note quote is in the notes;
 * - fact and number ids exist in the notes;
 * - the category has the evidence it needs (`CATEGORY_RULES`), and a `number_wrong_meaning`
 *   quotes text that states a value of its research number;
 * - the owner may own the category, and every field is the owner's;
 * - in a second round, each earlier issue gets exactly one status.
 */

/** The text of one beat as the review input shows it, for quote checks. */
export type ReviewBeatTexts = {
  beatId: string;
  narration: string;
  headline: readonly string[];
  tag: readonly string[];
  stat_card: readonly string[];
  source: readonly string[];
  /** Each element on the beat's board (`<instance>/<id>` too) → its texts and values. */
  labels: Readonly<Record<string, readonly string[]>>;
  /** Each numeric value an element this beat adds draws: PASS claims lists each one. */
  drawnValues?: readonly DrawnValue[];
};

/** One value drawn on a board: an element's number, or a number in one of its texts. */
export type DrawnValue = {
  elementId: string;
  /** The prop it is drawn from (`from`, `value`, `subtitle`). */
  key: string;
  /** As drawn ("99", "24"). */
  value: string;
  /** `numberKey` of the value, to match an entry's text. */
  valueKey: string;
};

export type ReviewCheckContext = {
  beats: readonly ReviewBeatTexts[];
  notes: ResearchNotes;
  /** In a second round: the ids of the earlier issues (`issue-<n>`), each needing a status. */
  previousIds?: readonly string[];
  /**
   * PASS claims in a scoped round: only these beats must be listed (the others' audit carries
   * over), and their narration sentences only when `narration` (false: a board-only change, its
   * drawn values alone). Absent: every beat, sentences and values.
   */
  coverage?: { readonly beatIds: readonly string[]; readonly narration: boolean };
};

export const REVIEW_PROBLEM_CODES = [
  'unknown_beat',
  'quote_not_found',
  'unknown_element',
  'unknown_research_id',
  'evidence_missing',
  'number_not_in_quote',
  'owner_not_allowed',
  'field_not_owned',
  'previous_status_missing',
  'unknown_previous_issue',
  'category_not_in_pass',
  'claim_missing',
  'value_claim_missing',
  'claim_ids_missing',
  'claim_restatement_missing',
  'claim_issue_missing',
  'claim_drops_condition',
] as const;
export type ReviewProblemCode = (typeof REVIEW_PROBLEM_CODES)[number];

export type ReviewProblem = { path: string; code: ReviewProblemCode; message: string };

export function curatorIssueProblems(value: unknown, ctx: ReviewCheckContext): ReviewProblem[] {
  if (!isRecord(value)) return [];
  const issues = Array.isArray(value.issues) ? value.issues : [];
  const research = researchTexts(ctx.notes);
  return [
    ...issues.flatMap((issue, i) =>
      isRecord(issue) ? issueProblems(issue, i, ctx, research) : [],
    ),
    ...previousProblems(value.previous, ctx.previousIds),
  ];
}

type Research = {
  facts: ReadonlyMap<string, string>;
  numbers: ReadonlySet<string>;
  notes: string[];
};

function researchTexts(notes: ResearchNotes): Research {
  return {
    facts: new Map(notes.facts.map((f) => [f.id, f.statement])),
    numbers: new Set(notes.numbers.map((n) => n.id)),
    notes: stringsOf(notes),
  };
}

/** Every string in the notes (ids and chunk citations included; they never match a quote). */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (isRecord(value)) return Object.values(value).flatMap(stringsOf);
  return [];
}

function issueProblems(
  issue: Json,
  i: number,
  ctx: ReviewCheckContext,
  research: Research,
): ReviewProblem[] {
  const beatId = text(issue.beatId);
  const beat = ctx.beats.find((b) => b.beatId === beatId);
  const evidence = Array.isArray(issue.evidence) ? issue.evidence.filter(isRecord) : [];
  const unknownBeat =
    beatId !== undefined && !beat
      ? [
          problem(
            ['issues', i, 'beatId'],
            'unknown_beat',
            `There is no beat "${beatId}". Use a beat id from the input: ` +
              `${ctx.beats.map((b) => b.beatId).join(', ')}.`,
          ),
        ]
      : [];
  const category = REVIEW_CATEGORIES.find((c) => c === issue.category);
  return [
    ...unknownBeat,
    ...(beat ? evidence.flatMap((e, j) => evidenceProblems(e, [i, j], beat, research)) : []),
    ...(category ? categoryProblems(category, evidence, i, ctx.notes) : []),
    ...ownerProblems(issue, i, category),
  ];
}

// --- Quotes and ids --------------------------------------------------------------------------------

function evidenceProblems(
  e: Json,
  [i, j]: [number, number],
  beat: ReviewBeatTexts,
  research: Research,
): ReviewProblem[] {
  const path = ['issues', i, 'evidence', j];
  const quote = text(e.quote);
  switch (e.kind) {
    case 'narration':
      return quoteIn(quote, [beat.narration], path, `${beat.beatId}'s narration`);
    case 'headline':
    case 'tag':
    case 'stat_card':
    case 'source':
      return quoteIn(quote, beat[e.kind], path, `${beat.beatId}'s ${e.kind.replace('_', ' ')}s`);
    case 'label':
      return labelProblems(e, quote, beat, path);
    case 'fact': {
      const id = text(e.id) ?? '';
      const statement = research.facts.get(id);
      if (statement === undefined) return [unknownId(path, id, 'fact')];
      return quote === undefined ? [] : quoteIn(quote, [statement], path, `${id}`);
    }
    case 'number': {
      const id = text(e.id) ?? '';
      return research.numbers.has(id) ? [] : [unknownId(path, id, 'number')];
    }
    case 'note':
      return quoteIn(quote, research.notes, path, 'the research notes');
    default:
      return [];
  }
}

function labelProblems(
  e: Json,
  quote: string | undefined,
  beat: ReviewBeatTexts,
  path: Path,
): ReviewProblem[] {
  const id = text(e.elementId) ?? '';
  const texts = beat.labels[id];
  if (!texts) {
    const ids = Object.keys(beat.labels);
    return [
      problem(
        [...path, 'elementId'],
        'unknown_element',
        `"${id}" is not on ${beat.beatId}'s board. Its elements: ` +
          `${ids.length > 0 ? ids.join(', ') : 'none'}.`,
      ),
    ];
  }
  const shown = texts.length > 0 ? texts.map((t) => `"${t}"`).join(', ') : 'none';
  return quoteIn(quote, texts, path, `${id}'s texts and values (${shown})`);
}

function unknownId(path: Path, id: string, kind: 'fact' | 'number'): ReviewProblem {
  const prefix = kind === 'fact' ? 'fact' : 'num';
  return problem(
    [...path, 'id'],
    'unknown_research_id',
    `"${id}" is not a ${kind} in the notes. Use a "${prefix}-<n>" id the notes give.`,
  );
}

function quoteIn(
  quote: string | undefined,
  texts: readonly string[],
  path: Path,
  where: string,
): ReviewProblem[] {
  if (quote !== undefined && quoteFound(quote, texts)) return [];
  return [
    problem(
      [...path, 'quote'],
      'quote_not_found',
      `"${quote ?? ''}" is not in ${where}. Copy the words exactly as the input gives them ` +
        '(use "..." to leave words out), or quote where the problem really is.',
    ),
  ];
}

/** Lower case, typographic quotes and dashes made plain, whitespace collapsed. */
function normalized(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The quote's pieces (split at "..."), without the quote marks or end punctuation around it. */
function quotePieces(quote: string): string[] {
  return normalized(quote)
    .replace(/^["'\s]+|["'.,;:!?\s]+$/g, '')
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((p) => p.replace(/^["'\s]+|["'.,;:!?\s]+$/g, ''))
    .filter((p) => p.length > 0);
}

/** Every piece found, in order, within one text (or within the texts joined, for labels). */
export function quoteFound(quote: string, texts: readonly string[]): boolean {
  const pieces = quotePieces(quote);
  if (pieces.length === 0) return false;
  const haystacks = [...texts.map(normalized), normalized(texts.join(' '))];
  return haystacks.some((haystack) => {
    let from = 0;
    for (const piece of pieces) {
      const at = haystack.indexOf(piece, from);
      if (at < 0) return false;
      from = at + piece.length;
    }
    return true;
  });
}

// --- Category, owner and fields --------------------------------------------------------------------

function categoryProblems(
  category: ReviewCategory,
  evidence: readonly Json[],
  i: number,
  notes: ResearchNotes,
): ReviewProblem[] {
  const rule = CATEGORY_RULES[category];
  if (!evidence.some((e) => rule.needs.includes(e.kind as never))) {
    return [
      problem(
        ['issues', i, 'evidence'],
        'evidence_missing',
        `A ${category} issue needs evidence of kind ${rule.needs.join(' or ')}.`,
      ),
    ];
  }
  return category === 'number_wrong_meaning' ? meaningProblems(evidence, i, notes) : [];
}

/**
 * A wrong-meaning issue names the research number (`number`) whose value appears with the
 * wrong meaning, and quotes the words or label that state that value.
 */
function meaningProblems(
  evidence: readonly Json[],
  i: number,
  notes: ResearchNotes,
): ReviewProblem[] {
  const index = numberIndex(notes);
  const quoted = evidence
    .filter((e) => SHOWN_KINDS.includes(e.kind as never))
    .flatMap((e) => numberMentions(text(e.quote) ?? '').map((m) => numberKey(m.value)));
  return evidence.flatMap((e, j) => {
    if (e.kind !== 'number') return [];
    const id = text(e.id) ?? '';
    const keys = index.keysById.get(id);
    if (!keys || [...keys].some((k) => quoted.includes(k))) return [];
    const value = notes.numbers.find((n) => n.id === id)?.value ?? '';
    return [
      problem(
        ['issues', i, 'evidence', j],
        'number_not_in_quote',
        `No quote in this issue states ${id}'s value (${value}). Quote the narration words or ` +
          'the label that use that number with the wrong meaning.',
      ),
    ];
  });
}

function ownerProblems(
  issue: Json,
  i: number,
  category: ReviewCategory | undefined,
): ReviewProblem[] {
  const owner = CURATOR_OWNERS.find((o) => o === issue.owner);
  if (!owner) return [];
  const allowed = category ? CATEGORY_RULES[category].owners : CURATOR_OWNERS;
  const ownerIssue = allowed.includes(owner)
    ? []
    : [
        problem(
          ['issues', i, 'owner'],
          'owner_not_allowed',
          `A ${category ?? ''} issue is owned by ${allowed.join(' or ')}, not ${owner}: name the ` +
            'agent that would change the quoted text or board.',
        ),
      ];
  return [...ownerIssue, ...fieldProblems(issue.fields, i, owner)];
}

function fieldProblems(fields: unknown, i: number, owner: CuratorOwner): ReviewProblem[] {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field, j) => {
    const known = FIX_FIELDS.find((f) => f === field);
    if (!known || FIELD_OWNERS[known] === owner) return [];
    const own = FIX_FIELDS.filter((f: FixField) => FIELD_OWNERS[f] === owner);
    return [
      problem(
        ['issues', i, 'fields', j],
        'field_not_owned',
        `${known} is the ${FIELD_OWNERS[known]}'s, not the ${owner}'s. The ${owner} changes ` +
          `only ${own.join(', ')}.`,
      ),
    ];
  });
}

// --- A second round's statuses ---------------------------------------------------------------------

function previousProblems(previous: unknown, ids: readonly string[] | undefined): ReviewProblem[] {
  if (!ids || ids.length === 0) return [];
  const given = (Array.isArray(previous) ? previous : []).filter(isRecord);
  const unknown = given.flatMap((p, j) => {
    const id = text(p.id) ?? '';
    return ids.includes(id)
      ? []
      : [
          problem(
            ['previous', j, 'id'],
            'unknown_previous_issue',
            `"${id}" is not one of the PREVIOUS ISSUES (${ids.join(', ')}).`,
          ),
        ];
  });
  const missing = ids.filter((id) => given.filter((p) => p.id === id).length !== 1);
  const missingIssue =
    missing.length > 0
      ? [
          problem(
            ['previous'],
            'previous_status_missing',
            `Give exactly one status (fixed or not_fixed) for each earlier issue; ` +
              `check ${missing.join(', ')}.`,
          ),
        ]
      : [];
  return [...unknown, ...missingIssue];
}
