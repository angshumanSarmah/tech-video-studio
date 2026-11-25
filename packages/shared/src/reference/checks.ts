import { containsPhrase } from '../text/phrase.ts';
import { builtInNamed } from './built-ins.ts';
import {
  ReferenceRecordSchema,
  WHOLE_VIDEO_DEVICES,
  type AvoidName,
  type ReferenceRecord,
} from './record.ts';

/**
 * Code checks on a reference record (P1C.11): the Reference analyst's `check` (failures are
 * repaired like schema errors) and a person's edit (a 400 with the issues). Catalogue ids exist,
 * nothing missing is already in the catalogue, and the structure fields hold no quoted wording,
 * no digits and no names (those belong in `namesToAvoid`). Pure; takes any JSON value.
 */

/** Words a quoted span in a record may hold: a term, never a line. */
export const MAX_QUOTED_WORDS = 3;

/** Words in a row the record may share with a span the breakdown quotes. */
export const COPIED_RUN_WORDS = 6;

/**
 * Capitalised words a structure field may use: generic acronyms and terms. Anything else
 * capitalised mid-sentence is read as a name (a brand, a product, a person).
 */
export const GENERIC_TERMS: ReadonlySet<string> = new Set([
  'AI',
  'API',
  'CDN',
  'CPU',
  'CSV',
  'DB',
  'DNS',
  'ETA',
  'GPU',
  'HTTP',
  'HTTPS',
  'I',
  'ID',
  'IP',
  'JSON',
  'KV',
  'LLM',
  'LRU',
  'ML',
  'OK',
  'OS',
  'OTP',
  'PDF',
  'QR',
  'RAM',
  'SDK',
  'SMS',
  'SQL',
  'SSD',
  'TCP',
  'TTL',
  'UDP',
  'UI',
  'URL',
]);

export const REFERENCE_PROBLEM_CODES = [
  'unknown_reference',
  'unmapped_is_registered',
  'unmapped_is_built_in',
  'unmapped_duplicate',
  'whole_video_device_on_beat',
  'hook_device_missing',
  'chapter_beat_out_of_range',
  'length_not_in_breakdown',
  'quoted_wording',
  'copied_wording',
  'name_in_structure',
  'proper_noun',
  'digits_in_text',
] as const;
export type ReferenceProblemCode = (typeof REFERENCE_PROBLEM_CODES)[number];

export interface ReferenceProblem {
  readonly path: string;
  readonly code: ReferenceProblemCode;
  readonly message: string;
}

export interface ReferenceCheckContext {
  /** Registered primitive and pattern ids (the renderer's registries). */
  readonly primitiveIds: ReadonlySet<string>;
  readonly patternIds: ReadonlySet<string>;
  /** The pasted breakdown: the record may not copy a span it quotes. */
  readonly breakdown?: string;
  /** Names the person marked to avoid, besides the record's own. */
  readonly extraNames?: readonly AvoidName[];
}

/** Every check on a record; nothing for a value that fails the schema (the schema reports it). */
export function referenceRecordProblems(
  value: unknown,
  ctx: ReferenceCheckContext,
): ReferenceProblem[] {
  const parsed = ReferenceRecordSchema.safeParse(value);
  if (!parsed.success) return [];
  const record = parsed.data;
  return [
    ...idProblems(record, ctx),
    ...unmappedProblems(record, ctx),
    ...deviceProblems(record),
    ...chapterProblems(record),
    ...lengthProblems(record, ctx),
    ...textProblems(record, ctx),
  ];
}

function idProblems(record: ReferenceRecord, ctx: ReferenceCheckContext): ReferenceProblem[] {
  const problems: ReferenceProblem[] = [];
  record.beats.forEach((beat, i) => {
    beat.patterns.forEach((id, j) => {
      if (!ctx.patternIds.has(id)) {
        problems.push(unknown(`$.beats[${i}].patterns[${j}]`, 'pattern', id, ctx.patternIds));
      }
    });
    beat.primitives.forEach((id, j) => {
      if (!ctx.primitiveIds.has(id)) {
        problems.push(unknown(`$.beats[${i}].primitives[${j}]`, 'primitive', id, ctx.primitiveIds));
      }
    });
  });
  record.unmapped.forEach((item, i) => {
    if (item.closest && !ctx.primitiveIds.has(item.closest) && !ctx.patternIds.has(item.closest)) {
      problems.push({
        path: `$.unmapped[${i}].closest`,
        code: 'unknown_reference',
        message: `"${item.closest}" is neither a primitive nor a pattern id: name one from the lists, or leave closest out.`,
      });
    }
  });
  return problems;
}

function unknown(
  path: string,
  what: string,
  id: string,
  known: ReadonlySet<string>,
): ReferenceProblem {
  return {
    path,
    code: 'unknown_reference',
    message: `"${id}" is not a ${what} id. Use one of: ${[...known].sort().join(', ')}; or put what is missing in unmapped.`,
  };
}

/** A name compared with registry ids: lower case, `-` as `_`, a plural `s` / `es` dropped. */
export function catalogueKey(name: string): string {
  const base = name.toLowerCase().replaceAll('-', '_');
  if (base.endsWith('es') && base.length > 4) return base.slice(0, -2);
  if (base.endsWith('s') && base.length > 3) return base.slice(0, -1);
  return base;
}

function unmappedProblems(record: ReferenceRecord, ctx: ReferenceCheckContext): ReferenceProblem[] {
  const registered = new Map<string, string>();
  for (const id of [...ctx.primitiveIds, ...ctx.patternIds]) registered.set(catalogueKey(id), id);
  const seen = new Set<string>();
  const problems: ReferenceProblem[] = [];
  record.unmapped.forEach((item, i) => {
    const key = catalogueKey(item.name);
    const id = registered.get(key);
    if (id) {
      problems.push({
        path: `$.unmapped[${i}].name`,
        code: 'unmapped_is_registered',
        message: `"${item.name}" is in the catalogue as "${id}": map it on its beat instead of listing it as missing.`,
      });
    }
    const builtIn = id ? undefined : builtInNamed(item.name);
    if (builtIn) {
      problems.push({
        path: `$.unmapped[${i}].name`,
        code: 'unmapped_is_built_in',
        message: `"${item.name}" is built into the renderer (${builtIn.id}): leave it out of unmapped.`,
      });
    }
    if (seen.has(key)) {
      problems.push({
        path: `$.unmapped[${i}].name`,
        code: 'unmapped_duplicate',
        message: `"${item.name}" is listed twice: keep one entry.`,
      });
    }
    seen.add(key);
  });
  return problems;
}

function deviceProblems(record: ReferenceRecord): ReferenceProblem[] {
  const whole: ReadonlySet<string> = new Set(WHOLE_VIDEO_DEVICES);
  const problems: ReferenceProblem[] = [];
  record.beats.forEach((beat, i) => {
    beat.devices.forEach((device, j) => {
      if (whole.has(device)) {
        problems.push({
          path: `$.beats[${i}].devices[${j}]`,
          code: 'whole_video_device_on_beat',
          message: `${device} spans the whole video: list it in videoDevices, not on one beat.`,
        });
      }
    });
  });
  const opening = new Set<string>([...record.videoDevices, ...(record.beats[0]?.devices ?? [])]);
  if (!opening.has(record.hook.device)) {
    problems.push({
      path: '$.hook.device',
      code: 'hook_device_missing',
      message: `The hook uses ${record.hook.device}: put it on the first beat's devices too.`,
    });
  }
  return problems;
}

function chapterProblems(record: ReferenceRecord): ReferenceProblem[] {
  const problems: ReferenceProblem[] = [];
  record.chapters.forEach((chapter, i) => {
    chapter.beats.forEach((index, j) => {
      if (index >= record.beats.length) {
        problems.push({
          path: `$.chapters[${i}].beats[${j}]`,
          code: 'chapter_beat_out_of_range',
          message: `There is no beat ${index}: beats are numbered from 0 to ${record.beats.length - 1}.`,
        });
      }
    });
  });
  return problems;
}

/** Seconds a stated length may differ from the record's. */
const LENGTH_TOLERANCE_SEC = 5;

/** Durations a text states: "1:45", "50 s", "90 seconds", "2 min". */
export function statedDurations(text: string): number[] {
  const found: number[] = [];
  for (const m of text.matchAll(/(?<!\d)(\d{1,2}):([0-5]\d)(?!\d)/g)) {
    found.push(Number(m[1]) * 60 + Number(m[2]));
  }
  for (const m of text.matchAll(
    /(?<![\d.])(\d+(?:\.\d+)?)\s*(s|secs?|seconds?|mins?|minutes?)\b/gi,
  )) {
    const unit = (m[2] ?? '').toLowerCase();
    found.push(Number(m[1]) * (unit.startsWith('m') ? 60 : 1));
  }
  return found;
}

function lengthProblems(record: ReferenceRecord, ctx: ReferenceCheckContext): ReferenceProblem[] {
  if (record.lengthSec === undefined || ctx.breakdown === undefined) return [];
  const length = record.lengthSec;
  const stated = statedDurations(ctx.breakdown);
  if (stated.some((sec) => Math.abs(sec - length) <= LENGTH_TOLERANCE_SEC)) return [];
  return [
    {
      path: '$.lengthSec',
      code: 'length_not_in_breakdown',
      message: `The breakdown does not state a length of about ${length} s: leave lengthSec out unless it says how long the video runs.`,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Text: no quoted wording, no copies of what the breakdown quotes, no names, no digits

/** The structure fields' text with its path (names to avoid and ids are not text). */
export function referenceTexts(record: ReferenceRecord): { path: string; text: string }[] {
  return [
    { path: '$.title', text: record.title },
    { path: '$.hook.shape', text: record.hook.shape },
    { path: '$.arc', text: record.arc },
    ...record.beats.map((b, i) => ({ path: `$.beats[${i}].summary`, text: b.summary })),
    ...record.pacing.map((text, i) => ({ path: `$.pacing[${i}]`, text })),
    ...record.unmapped.map((u, i) => ({
      path: `$.unmapped[${i}].description`,
      text: u.description,
    })),
  ];
}

function textProblems(record: ReferenceRecord, ctx: ReferenceCheckContext): ReferenceProblem[] {
  const names = [...record.namesToAvoid, ...(ctx.extraNames ?? [])];
  const quotedInBreakdown = ctx.breakdown ? quotedSpans(ctx.breakdown) : [];
  return referenceTexts(record).flatMap(({ path, text }) => [
    ...quoteProblems(path, text),
    ...copyProblems(path, text, quotedInBreakdown),
    ...nameProblems(path, text, names),
    ...properNounProblems(path, text, names),
    ...digitProblems(path, text),
  ]);
}

/** Spans between double quotes (straight or curly) or curly single quotes. */
export function quotedSpans(text: string): string[] {
  const spans: string[] = [];
  for (const match of text.matchAll(/"([^"\n]+)"|“([^”\n]+)”|‘([^’\n]+)’/g)) {
    const span = match[1] ?? match[2] ?? match[3];
    if (span) spans.push(span);
  }
  return spans;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function quoteProblems(path: string, text: string): ReferenceProblem[] {
  return quotedSpans(text)
    .filter((span) => words(span).length > MAX_QUOTED_WORDS)
    .map((span) => ({
      path,
      code: 'quoted_wording' as const,
      message: `"${span}" is quoted wording: describe what happens in your own words, without quotes.`,
    }));
}

function copyProblems(path: string, text: string, quoted: readonly string[]): ReferenceProblem[] {
  const own = ` ${words(text).join(' ')} `;
  for (const span of quoted) {
    const spanWords = words(span);
    for (let i = 0; i + COPIED_RUN_WORDS <= spanWords.length; i++) {
      const run = spanWords.slice(i, i + COPIED_RUN_WORDS).join(' ');
      if (own.includes(` ${run} `)) {
        return [
          {
            path,
            code: 'copied_wording',
            message: `"${run}" copies words the breakdown quotes from the video: describe it in your own words.`,
          },
        ];
      }
    }
  }
  return [];
}

function nameProblems(path: string, text: string, names: readonly AvoidName[]): ReferenceProblem[] {
  return names
    .filter((name) => containsPhrase(text, name.text, { plural: true }))
    .map((name) => ({
      path,
      code: 'name_in_structure' as const,
      message: `"${name.text}" is in namesToAvoid: describe it generically here ("a delivery app", "a sports event").`,
    }));
}

/** Where a new sentence or clause starts: a capital there is not a name. */
const SENTENCE_BREAK = /[.!?:;→·—(]$/;

/** A capitalised word that is not a generic term, where a name would be. */
function properNounProblems(
  path: string,
  text: string,
  names: readonly AvoidName[],
): ReferenceProblem[] {
  const found: string[] = [];
  let atStart = true;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (word && isNameLike(word, atStart) && !isGeneric(word) && !isAvoided(word, names)) {
      found.push(word);
    }
    atStart = SENTENCE_BREAK.test(token) || /^[→·—]$/.test(token);
  }
  return [...new Set(found)].map((word) => ({
    path,
    code: 'proper_noun' as const,
    message: `"${word}" reads as a name: move brand, product and people names to namesToAvoid and describe them generically here.`,
  }));
}

function isNameLike(word: string, atStart: boolean): boolean {
  if (!/\p{Lu}/u.test(word)) return false;
  if (!atStart) return true;
  // At a sentence start only an all-caps word or an inner capital ("iPhone", "AcmeDB") reads as a name.
  return /^\p{Lu}{2,}/u.test(word) || /\p{Ll}\p{Lu}/u.test(word);
}

function isGeneric(word: string): boolean {
  const upper = word.toUpperCase();
  const singular = upper.endsWith('S') ? upper.slice(0, -1) : upper;
  // Identifiers with digits ("2D", "3D", "L7") are not names.
  return GENERIC_TERMS.has(upper) || GENERIC_TERMS.has(singular) || /\d/.test(word);
}

function isAvoided(word: string, names: readonly AvoidName[]): boolean {
  return names.some((name) => containsPhrase(name.text, word));
}

/** Digits standing alone (a quantity); digits glued to letters are identifiers ("3D", "L7"). */
const QUANTITY = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?![\p{L}])/u;

function digitProblems(path: string, text: string): ReferenceProblem[] {
  const match = QUANTITY.exec(text);
  return match
    ? [
        {
          path,
          code: 'digits_in_text',
          message: `"${match[0]}" is a number from the original: its numbers are its examples. Say it without the value ("a short window"), or use a number field.`,
        },
      ]
    : [];
}
