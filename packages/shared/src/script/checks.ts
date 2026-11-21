import type { ExplanationLevel } from '../config/video.ts';
import { MAX_NUMBERS_PER_BEAT } from '../director/checks.ts';
import { bareSourceMessage, isBareSourceLine } from '../research/source-names.ts';
import type { DirectorPlan } from '../director/plan.ts';
import { narrationWords } from '../spec/narration.ts';
import type { BeatScript } from '../spec/script.ts';
import {
  planVideos,
  problem,
  quoted,
  type BeatPauses,
  type Path,
  type ScriptCheckContext,
  type ScriptProblem,
  type ScriptToCheck,
} from './context.ts';
import { numberKey, numberMentions, type NumberMention } from './number-mentions.ts';
import { dateOnlyKeys, researchValueKeys } from './note-values.ts';
import {
  conceptHeadlineProblems,
  repeatedHeadlineProblems,
  statCardProblems,
  tagProblems,
} from './screen-checks.ts';
import { mainTerm, mentionsTerm } from './terms.ts';

/**
 * Deterministic checks on the Scriptwriter's output (P1C.6), beyond its schema and the spec's own
 * validation: word budgets, sentence length, numbers (every one a research value, spoken ones
 * included; one per sentence at the beginner level), the hook's numbers, new terms introduced in
 * their beat, the topic defined early, source lines, and the on-screen text (stat cards, tags,
 * headlines: `screen-checks.ts`). Pure; the worker runs it with the spec, HUD, subtitle and
 * primitive checks, and gate edits can reuse it.
 */

/** A narration may be this much over or under its word budget. */
export const WORD_BUDGET_TOLERANCE = 0.15;

/** Words one narration sentence may have (the prompt asks for under 15). */
export const MAX_SENTENCE_WORDS = 20;

/** Levels at which a sentence carries at most one number. */
const ONE_NUMBER_LEVELS: readonly ExplanationLevel[] = ['beginner'];

export interface WordBudget {
  readonly beatId: string;
  readonly targetSec: number;
  /** Planned seconds less the beat's pauses: the time its narration fills. */
  readonly narrationSec: number;
  /** `narrationSec × wordsPerSec`, rounded. */
  readonly words: number;
  readonly min: number;
  readonly max: number;
}

/** The last beat of each video (each part, or the whole plan): no beat gap follows it. */
function lastBeatIds(plan: DirectorPlan): Set<string> {
  return new Set(planVideos(plan).flatMap((ids) => ids.slice(-1)));
}

/**
 * Each beat's word budget: `(targetSec − its pauses) × wordsPerSec`, ±`WORD_BUDGET_TOLERANCE`.
 * A beat's pauses are the landing hold and the gap before the next beat (none after a video's
 * last beat); the end tail comes after the planned length.
 */
export function wordBudgets(
  plan: DirectorPlan,
  wordsPerSec: number,
  pauses: BeatPauses,
): WordBudget[] {
  const lasts = lastBeatIds(plan);
  return plan.story.beats.map((beat) => {
    const gap = lasts.has(beat.id) ? 0 : pauses.beatGapSec;
    const narrationSec = Math.max(0, beat.targetSec - gap - pauses.landingSec);
    const exact = narrationSec * wordsPerSec;
    return {
      beatId: beat.id,
      targetSec: beat.targetSec,
      narrationSec,
      words: Math.round(exact),
      min: Math.round(exact * (1 - WORD_BUDGET_TOLERANCE)),
      max: Math.round(exact * (1 + WORD_BUDGET_TOLERANCE)),
    };
  });
}

export function scriptProblems(output: ScriptToCheck, ctx: ScriptCheckContext): ScriptProblem[] {
  const values = researchValueKeys(ctx.notes);
  return [
    ...budgetProblems(output, ctx),
    ...sentenceProblems(output, ctx, dateOnlyKeys(ctx.notes)),
    ...digitProblems(output),
    ...output.script.flatMap((beat, i) => numberProblems(beat, i, values)),
    ...numbersPerBeatProblems(output, ctx),
    ...statCardProblems(output, ctx),
    ...tagProblems(output),
    ...conceptHeadlineProblems(output, ctx.plan, ctx.notes),
    ...repeatedHeadlineProblems(output),
    ...hookProblems(output, ctx),
    ...newTermProblems(output, ctx.plan),
    ...topicProblems(output, ctx),
    ...sourceProblems(output, ctx.plan, ctx.sourceNames),
  ];
}

// --- Word budget and sentences ----------------------------------------------------------------

function budgetProblems(output: ScriptToCheck, ctx: ScriptCheckContext): ScriptProblem[] {
  const budgets = new Map(
    wordBudgets(ctx.plan, ctx.wordsPerSec, ctx.pauses).map((b) => [b.beatId, b]),
  );
  return output.script.flatMap((beat, i) => {
    const budget = budgets.get(beat.beatId);
    if (!budget) return [];
    const count = narrationWords(beat.narration).length;
    if (count >= budget.min && count <= budget.max) return [];
    const over = count > budget.max;
    const change = over ? `Cut ${count - budget.max}` : `Add ${budget.min - count}`;
    // Name the rules a fix tends to break, so a repair does not trade one problem for another.
    const keep = ONE_NUMBER_LEVELS.includes(ctx.level)
      ? 'and without putting two numbers in one sentence'
      : `and without a sentence over ${MAX_SENTENCE_WORDS} words`;
    return [
      problem(
        ['script', i, 'narration'],
        over ? 'narration_over_budget' : 'narration_under_budget',
        `Beat "${beat.beatId}" has ${count} words; its budget is ${budget.min}-${budget.max} ` +
          `(${budget.narrationSec} s × ${ctx.wordsPerSec} words/s, ±15%). ${change} or more ` +
          `words, without dropping what the visuals anchor to ${keep}: drop a detail the idea ` +
          'does not need.',
      ),
    ];
  });
}

/** Sentences of a narration: split after `.`, `!` or `?` followed by a space. */
export function sentences(narration: string): string[] {
  return narration
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => narrationWords(s).length > 0);
}

/** Numbers a sentence says that count as numbers (lone everyday "one", "two", "three" do not). */
function countedMentions(text: string): NumberMention[] {
  return numberMentions(text).filter((m) => !m.everyday);
}

/** "the beat has 33 words, at most 34": the room a split has, so it does not break the budget. */
function budgetRoom(beat: BeatScript, budget: WordBudget | undefined): string {
  const count = narrationWords(beat.narration).length;
  return budget ? ` (the beat has ${count} words, at most ${budget.max})` : '';
}

function sentenceProblems(
  output: ScriptToCheck,
  ctx: ScriptCheckContext,
  dates: ReadonlySet<string>,
): ScriptProblem[] {
  const { level } = ctx;
  const oneNumber = ONE_NUMBER_LEVELS.includes(level);
  const budgets = new Map(
    wordBudgets(ctx.plan, ctx.wordsPerSec, ctx.pauses).map((b) => [b.beatId, b]),
  );
  return output.script.flatMap((beat, i) =>
    sentences(beat.narration).flatMap((sentence, n) => {
      const room = budgetRoom(beat, budgets.get(beat.beatId));
      const path = ['script', i, 'narration'];
      const where = `Beat "${beat.beatId}", sentence ${n + 1} (${quoted(sentence)})`;
      const words = narrationWords(sentence).length;
      const numbers = oneNumber ? sentenceNumbers(sentence, dates) : [];
      return [
        ...(words > MAX_SENTENCE_WORDS
          ? [
              problem(
                path,
                'sentence_too_long',
                `${where} has ${words} words; keep every sentence to ${MAX_SENTENCE_WORDS} words ` +
                  `or fewer (aim under 15): split it without going over the beat's budget${room}.`,
              ),
            ]
          : []),
        ...(numbers.length > 1
          ? [
              problem(
                path,
                'numbers_per_sentence',
                `${where} says ${numbers.length} numbers (${numbers.map((m) => `"${m}"`).join(', ')}); ` +
                  `at the ${level} level a sentence carries at most one number: split it without ` +
                  `going over the beat's budget${room}; drop a detail if the split needs words.`,
              ),
            ]
          : []),
      ];
    }),
  );
}

// --- Numbers ----------------------------------------------------------------------------------

/** The numbers a text says that count toward a density limit: no everyday words, no dates. */
function quantities(text: string, dates: ReadonlySet<string>): NumberMention[] {
  return countedMentions(text).filter((m) => !dates.has(numberKey(m.value)));
}

/** "from <X>" right before the first number of a range ("from about one millisecond"). */
const RANGE_FROM = /(?:^|[^\p{L}])from\s+(?:about\s+|around\s+|roughly\s+)?$/iu;
/** "<unit> to" between a range's two numbers ("milliseconds to", "to"). */
const RANGE_TO = /^[\s\p{L}-]{0,30}?(?:^|[^\p{L}])to\s+(?:about\s+|around\s+|roughly\s+)?$/iu;

/**
 * The numbers a sentence says, as the viewer hears them (a lone "one", "two" or "three" only
 * with a unit: "two seconds", not "two nodes"): a "from X to Y" range is one number
 * (one change), so "from two hundred milliseconds to two seconds" counts once; "two hundred
 * milliseconds and two seconds" counts twice. Each value is still checked against the notes.
 */
function sentenceNumbers(sentence: string, dates: ReadonlySet<string>): string[] {
  // A lone everyday word counts here when a unit follows it: "two seconds" is a number.
  const mentions = numberMentions(sentence).filter(
    (m) => (!m.everyday || m.measured) && !dates.has(numberKey(m.value)),
  );
  const numbers: string[] = [];
  for (let i = 0; i < mentions.length; i += 1) {
    const a = mentions[i]!;
    const b = mentions[i + 1];
    const end = a.index + a.text.length;
    const range =
      b !== undefined &&
      RANGE_FROM.test(sentence.slice(0, a.index)) &&
      RANGE_TO.test(sentence.slice(end, b.index));
    numbers.push(range ? `from ${a.text} to ${b.text}` : a.text);
    if (range) i += 1;
  }
  return numbers;
}

/** A token of narration that holds a digit, without the punctuation around it. */
function digitTokens(narration: string): string[] {
  const tokens = narration
    .split(/\s+/)
    .filter((t) => /\d/.test(t))
    .map((t) => t.replace(/^[("'“‘[]+|[)"'”’.,;:!?\]]+$/gu, ''));
  return [...new Set(tokens)];
}

/** Narration is spoken: numbers are written as words, so text-to-speech reads them as meant. */
function digitProblems(output: ScriptToCheck): ScriptProblem[] {
  return output.script.flatMap((beat, i) =>
    digitTokens(beat.narration).map((token) =>
      problem(
        ['script', i, 'narration'],
        'digits_in_narration',
        `Beat "${beat.beatId}"'s narration writes "${token}" in digits: write it as spoken ` +
          `(e.g. 'one point three').`,
      ),
    ),
  );
}

/**
 * At most the level's number of distinct numbers in a beat's narration, so the viewer can hold
 * them. Lone everyday words and values the notes give only as dates ("March twenty twenty-five")
 * do not count.
 */
function numbersPerBeatProblems(output: ScriptToCheck, ctx: ScriptCheckContext): ScriptProblem[] {
  const limit = MAX_NUMBERS_PER_BEAT[ctx.level];
  const dates = dateOnlyKeys(ctx.notes);
  return output.script.flatMap((beat, i) => {
    const said = new Map(
      quantities(beat.narration, dates).map((m) => [numberKey(m.value), m.text] as const),
    );
    if (said.size <= limit) return [];
    return [
      problem(
        ['script', i, 'narration'],
        'numbers_per_beat',
        `Beat "${beat.beatId}" says ${said.size} numbers (${[...said.values()].map((t) => `"${t}"`).join(', ')}); ` +
          `at the ${ctx.level} level a beat says at most ${limit}. Keep the ones the beat turns ` +
          'on and leave the other details out.',
      ),
    ];
  });
}

/** The texts of a beat checked for numbers (sources and LaTeX are not). */
function numberFields(beat: BeatScript): [Path, string][] {
  return [
    [['narration'], beat.narration],
    [['headline', 'text'], beat.headline?.text ?? ''],
    ...beat.tags.map((tag, j): [Path, string] => [['tags', j], tag]),
    ...beat.statCards.map((card, j): [Path, string] => [['statCards', j, 'label'], card.label]),
    [['formulaCard', 'caption'], beat.formulaCard?.caption ?? ''],
    [['commandBubble', 'text'], beat.commandBubble?.text ?? ''],
  ];
}

function numberProblems(
  beat: BeatScript,
  index: number,
  values: ReadonlySet<string>,
): ScriptProblem[] {
  return numberFields(beat).flatMap(([field, text]) => {
    const missing = countedMentions(text).filter((m) => !values.has(numberKey(m.value)));
    const unique = [...new Map(missing.map((m) => [m.text.toLowerCase(), m])).values()];
    return unique.map((m) =>
      problem(
        ['script', index, ...field],
        'number_not_in_notes',
        `"${m.text}" (${numberKey(m.value)}) is not a research number value. Say only numbers ` +
          'from the notes, spoken or as digits; never derive one (no products, sums or ' +
          'conversions), or leave the number out.',
      ),
    );
  });
}

/** The hook says each of its numbers (`hookNumberIds`), spoken or as digits. */
function hookProblems(output: ScriptToCheck, ctx: ScriptCheckContext): ScriptProblem[] {
  const numbers = new Map(ctx.notes.numbers.map((n) => [n.id, n]));
  const plans = new Map(ctx.plan.story.beats.map((b) => [b.id, b]));
  return output.script.flatMap((beat, i) => {
    const said = new Set(numberMentions(beat.narration).map((m) => numberKey(m.value)));
    return (plans.get(beat.beatId)?.hookNumberIds ?? []).flatMap((id) => {
      const number = numbers.get(id);
      const keys = number ? numberMentions(number.value).map((m) => numberKey(m.value)) : [];
      if (keys.length === 0 || keys.some((k) => said.has(k))) return [];
      return [
        problem(
          ['script', i, 'narration'],
          'hook_number_missing',
          `The hook never says ${id} ("${number!.value}" ${number!.unit}); the plan builds the ` +
            'hook on it. Say it, spelled out as spoken.',
        ),
      ];
    });
  });
}

// --- Terms, topic and sources --------------------------------------------------------------------

function newTermProblems(output: ScriptToCheck, plan: DirectorPlan): ScriptProblem[] {
  const indexOf = new Map(output.script.map((s, i) => [s.beatId, i]));
  return plan.story.beats.flatMap((beat) => {
    const i = indexOf.get(beat.id);
    if (i === undefined) return [];
    return beat.newTerms.flatMap((term) => {
      const path = ['script', i, 'narration'];
      const earlier = output.script.slice(0, i).find((s) => mentionsTerm(s.narration, term));
      return [
        ...(mentionsTerm(output.script[i]!.narration, term)
          ? []
          : [
              problem(
                path,
                'new_term_missing',
                `Beat "${beat.id}" introduces "${term}" but its narration never names it. Name it ` +
                  'with its plain meaning, the first time the video uses it.',
              ),
            ]),
        ...(earlier
          ? [
              problem(
                ['script', indexOf.get(earlier.beatId)!, 'narration'],
                'new_term_too_early',
                `Beat "${earlier.beatId}" uses "${term}" before beat "${beat.id}" introduces it. ` +
                  'Describe the thing in plain words there, and name the term only from its beat.',
              ),
            ]
          : []),
      ];
    });
  });
}

/** Beats from the start of each video within which the topic is defined (beginner level). */
export const TOPIC_DEFINED_BY_BEAT = 2;

/**
 * At the beginner level, the first `TOPIC_DEFINED_BY_BEAT` beats of each video name the topic's
 * main term (`mainTerm`), so the viewer knows what the video is about. Skipped when the plan
 * introduces that term later (`newTerms`): the plan decided where it is named.
 */
function topicProblems(output: ScriptToCheck, ctx: ScriptCheckContext): ScriptProblem[] {
  if (ctx.level !== 'beginner') return [];
  const glossary = ctx.notes.glossary.map((g) => g.term);
  const term = mainTerm(ctx.plan.meta.title, ctx.topicTitle, glossary);
  const indexOf = new Map(output.script.map((s, i) => [s.beatId, i]));
  return planVideos(ctx.plan).flatMap((beatIds) => {
    const early = beatIds.slice(0, TOPIC_DEFINED_BY_BEAT);
    const later = new Set(beatIds.slice(TOPIC_DEFINED_BY_BEAT));
    const introducedLater = ctx.plan.story.beats.some(
      (b) => later.has(b.id) && b.newTerms.some((t) => mentionsTerm(term, t)),
    );
    const first = indexOf.get(early[0] ?? '');
    if (introducedLater || first === undefined) return [];
    const named = early.some((id) => {
      const i = indexOf.get(id);
      return i !== undefined && mentionsTerm(output.script[i]!.narration, term);
    });
    if (named) return [];
    return [
      problem(
        ['script', first, 'narration'],
        'topic_not_defined',
        `Neither ${early.map((id) => `"${id}"`).join(' nor ')} names "${term}", the video's ` +
          `main term. At the ${ctx.level} level, say by the end of beat ${early.length} in one ` +
          'plain sentence what it is and what it does.',
      ),
    ];
  });
}

/**
 * A beat with stat cards or a planned source has a source line; a planned one is kept word for
 * word (the Director took it from the notes), unless it is a bare name; no line is a bare name.
 */
function sourceProblems(
  output: ScriptToCheck,
  plan: DirectorPlan,
  names: readonly string[] = [],
): ScriptProblem[] {
  const plans = new Map(plan.story.beats.map((b) => [b.id, b]));
  return output.script.flatMap((beat, i) => {
    const planned = plans.get(beat.beatId)?.source;
    if (beat.source) {
      if (isBareSourceLine(beat.source, names)) {
        return [
          problem(
            ['script', i, 'source'],
            'source_label_bare',
            bareSourceMessage(`Beat "${beat.beatId}"'s`, beat.source),
          ),
        ];
      }
      const keep = planned && !isBareSourceLine(planned, names);
      if (!keep || beat.source.trim() === planned.trim()) return [];
      return [
        problem(
          ['script', i, 'source'],
          'source_changed',
          `Beat "${beat.beatId}" changes its planned source line to "${beat.source}". Keep the ` +
            `plan's line word for word: "${planned}".`,
        ),
      ];
    }
    if (!planned && beat.statCards.length === 0) return [];
    const reason = planned
      ? `the plan gives it the source "${planned}"`
      : 'its stat cards show sourced numbers';
    return [
      problem(
        ['script', i, 'source'],
        'source_missing',
        `Beat "${beat.beatId}" needs a source line: ${reason}.`,
      ),
    ];
  });
}
