import { foldTerm } from '../director/checks.ts';
import type { DirectorPlan } from '../director/plan.ts';
import type { ResearchNotes } from '../research/notes.ts';
import type { BeatScript } from '../spec/script.ts';
import { planVideos, problem, type ScriptProblem, type ScriptToCheck } from './context.ts';
import { MAX_STAT_CARDS_PER_BEAT, MAX_STAT_CARDS_PER_VIDEO } from './limits.ts';
import { isNumberWord } from '../research/numbers.ts';
import { numberKey, numberMentions } from './number-mentions.ts';
import { mentionsTerm } from './terms.ts';

/**
 * Checks on the on-screen text the Scriptwriter writes: stat cards (a research number, shown as
 * written, spoken in the beat, few of them), tags (no stat card repeated) and headlines (a
 * concept headline where a term is introduced, each with its own takeaway). Pure.
 */

const valueKeys = (text: string) => new Set(numberMentions(text).map((m) => numberKey(m.value)));

// --- Stat cards -------------------------------------------------------------------------------

export function statCardProblems(
  output: ScriptToCheck,
  ctx: {
    readonly plan: DirectorPlan;
    readonly notes: ResearchNotes;
  },
): ScriptProblem[] {
  return [
    ...output.script.flatMap((beat, i) => [
      ...cardCountProblem(beat, i),
      ...beat.statCards.flatMap((_, j) => cardProblems(beat, i, j, ctx.notes)),
    ]),
    ...videoCardProblems(output, ctx.plan),
  ];
}

function cardCountProblem(beat: BeatScript, index: number): ScriptProblem[] {
  if (beat.statCards.length <= MAX_STAT_CARDS_PER_BEAT) return [];
  return [
    problem(
      ['script', index, 'statCards'],
      'stat_cards_per_beat',
      `Beat "${beat.beatId}" has ${beat.statCards.length} stat cards; keep at most ` +
        `${MAX_STAT_CARDS_PER_BEAT}: the one number the beat is about.`,
    ),
  ];
}

function cardProblems(
  beat: BeatScript,
  index: number,
  j: number,
  notes: ResearchNotes,
): ScriptProblem[] {
  const card = beat.statCards[j]!;
  const path = ['script', index, 'statCards', j];
  const cited = notes.numbers.find((n) => n.id === card.sourceRef);
  if (!cited) {
    return [
      problem(
        [...path, 'sourceRef'],
        'stat_card_not_a_number',
        `"${card.sourceRef}" is not a research number id. A stat card shows one research ` +
          'number and cites its "num-<n>" id; drop the card when no number fits.',
      ),
    ];
  }
  const want = valueKeys(cited.value);
  const shown = numberMentions(card.value);
  const matches = shown.length > 0 && shown.every((m) => want.has(numberKey(m.value)));
  const said = valueKeys(beat.narration);
  return [
    ...(matches
      ? []
      : [
          problem(
            [...path, 'value'],
            'stat_card_value_mismatch',
            `The card shows "${card.value}", but ${cited.id} is "${cited.value}" ${cited.unit}. ` +
              'Show the cited number as written, with its unit.',
          ),
        ]),
    ...([...want].some((k) => said.has(k))
      ? []
      : [
          problem(
            path,
            'stat_card_not_spoken',
            `Beat "${beat.beatId}" shows ${cited.id} ("${cited.value}" ${cited.unit}) on a card ` +
              'but never says it. Say the number in the narration, or drop the card.',
          ),
        ]),
  ];
}

/** At most `MAX_STAT_CARDS_PER_VIDEO` per video; reported once, at the first card over. */
function videoCardProblems(output: ScriptToCheck, plan: DirectorPlan): ScriptProblem[] {
  const indexOf = new Map(output.script.map((s, i) => [s.beatId, i]));
  return planVideos(plan).flatMap((beatIds) => {
    const cards = beatIds.flatMap((id) => {
      const i = indexOf.get(id);
      return i === undefined ? [] : output.script[i]!.statCards.map((_, j) => ({ id, i, j }));
    });
    const over = cards[MAX_STAT_CARDS_PER_VIDEO];
    if (!over) return [];
    const beats = [...new Set(cards.map((c) => c.id))].join(', ');
    return [
      problem(
        ['script', over.i, 'statCards', over.j],
        'stat_cards_per_video',
        `The video has ${cards.length} stat cards (beats ${beats}); keep at most ` +
          `${MAX_STAT_CARDS_PER_VIDEO}, for the numbers the story turns on, and drop the rest.`,
      ),
    ];
  });
}

// --- Tags -------------------------------------------------------------------------------------

export function tagProblems(output: ScriptToCheck): ScriptProblem[] {
  return output.script.flatMap((beat, i) => {
    const cards = new Set(beat.statCards.flatMap((c) => [...valueKeys(c.value)]));
    return beat.tags.flatMap((tag, j) =>
      [...valueKeys(tag)].some((k) => cards.has(k))
        ? [
            problem(
              ['script', i, 'tags', j],
              'tag_repeats_stat_card',
              `Tag "${tag}" repeats the number on beat "${beat.beatId}"'s stat card. Tag a ` +
                'state, outcome or term instead, or drop it.',
            ),
          ]
        : [],
    );
  });
}

// --- Headlines --------------------------------------------------------------------------------

/** "X = plain meaning": the term, then its meaning. */
const CONCEPT_HEADLINE = /^(.+?)\s+=\s+\S/;

/**
 * A beat that introduces a term gets a concept headline naming it: "<term> = <plain meaning>",
 * semantic `concept`.
 */
export function conceptHeadlineProblems(
  output: ScriptToCheck,
  plan: DirectorPlan,
  notes: ResearchNotes,
): ScriptProblem[] {
  const glossary = new Map(notes.glossary.map((g) => [foldTerm(g.term), g.plainMeaning]));
  const terms = new Map(plan.story.beats.map((b) => [b.id, b.newTerms]));
  return output.script.flatMap((beat, i) => {
    const term = terms.get(beat.beatId)?.[0];
    if (!term) return [];
    const head = beat.headline && CONCEPT_HEADLINE.exec(beat.headline.text)?.[1];
    if (beat.headline?.semantic === 'concept' && head && mentionsTerm(head, term)) return [];
    const meaning = glossary.get(foldTerm(term));
    return [
      problem(
        ['script', i, 'headline'],
        'headline_not_concept',
        `Beat "${beat.beatId}" introduces "${term}": give it a concept headline (semantic ` +
          `"concept") that reads "${term} = <plain meaning in a few words>"` +
          (meaning ? `, from the glossary: "${meaning}".` : '.'),
      ),
    ];
  });
}

/** Words that say nothing about a headline's takeaway. */
const STOPWORDS = new Set(
  'a an the of to in on at for and or but is are be it its by with from as per vs not no'.split(
    ' ',
  ),
);

/** Text in quotes is an example word ("'the' = one token"), not a claim the headline makes. */
const QUOTED = /(^|[\s(=:,;])['‘"“][^'’"”]+['’"”](?=$|[\s).,:;!?=])/gu;

/**
 * A headline's content words, lowercased and singular: no stopwords, number words, digits or
 * quoted example words.
 */
export function headlineWords(text: string): Set<string> {
  const words =
    text
      .replace(QUOTED, '$1')
      // A possessive "'s" is not a word ("the model's own tokenizer").
      .replace(/['’]s(?![\p{L}\d])/gu, '')
      .toLowerCase()
      .match(/[\p{L}\d]+(?:-[\p{L}\d]+)*/gu) ?? [];
  return new Set(
    words
      .filter((w) => !STOPWORDS.has(w) && !isNumberWord(w) && !/\d/.test(w))
      .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)),
  );
}

/** Headlines this short repeat each other only when they say exactly the same words. */
export const SHORT_HEADLINE_WORDS = 3;

/**
 * Whether two headlines' content words repeat: the same set when either has
 * `SHORT_HEADLINE_WORDS` or fewer (two short headlines often share a word by chance), else more
 * than half the shorter one's words shared.
 */
function headlinesRepeat(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const shared = [...a].filter((w) => b.has(w)).length;
  if (Math.min(a.size, b.size) <= SHORT_HEADLINE_WORDS) {
    return shared === a.size && shared === b.size;
  }
  return shared * 2 > Math.min(a.size, b.size);
}

/** No two headlines repeat each other's content words (`headlinesRepeat`). */
export function repeatedHeadlineProblems(output: ScriptToCheck): ScriptProblem[] {
  const heads = output.script.map((b) => (b.headline ? headlineWords(b.headline.text) : undefined));
  return output.script.flatMap((beat, j) => {
    const mine = heads[j];
    if (!mine) return [];
    const i = heads
      .slice(0, j)
      .findIndex((theirs) => theirs !== undefined && headlinesRepeat(mine, theirs));
    if (i < 0) return [];
    const earlier = output.script[i]!;
    return [
      problem(
        ['script', j, 'headline', 'text'],
        'headline_repeated',
        `Beat "${beat.beatId}"'s headline "${beat.headline!.text}" repeats most of beat ` +
          `"${earlier.beatId}"'s ("${earlier.headline!.text}"). State this beat's own takeaway.`,
      ),
    ];
  });
}
