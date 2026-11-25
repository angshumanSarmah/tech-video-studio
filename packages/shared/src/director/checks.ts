import { ENDING_DEVICES, type EndingDevice } from '../catalogues/devices.ts';
import type { ExplanationLevel, VideoSettings } from '../config/video.ts';
import type { ResearchNotes } from '../research/notes.ts';
import type { PartRef } from '../spec/meta.ts';
import { normalizeNumber, quantityTokens } from '../research/numbers.ts';
import { bareSourceMessage, isBareSourceLine } from '../research/source-names.ts';
import { containsPhrase } from '../text/phrase.ts';
import { numberIndex, numberValueKeys, researchNumberOf } from '../script/note-values.ts';
import { numberKey, numberMentions } from '../script/number-mentions.ts';
import { TARGET_LENGTH_TOLERANCE } from '../spec/integrity/warnings.ts';
import { toJsonPath } from '../spec/validate.ts';
import {
  BEGINNER_MAX_FACTS_PER_BEAT,
  BEGINNER_MAX_NUMBERS_PER_BEAT,
  MAX_BEATS_PER_PATTERN,
  MAX_BEATS_PER_SCENE,
  MAX_HOOK_NUMBERS,
  MAX_PUZZLE_HOOK_NUMBERS,
  type StoryBeat,
  MAX_SCENES_PER_LAYOUT_MODE,
} from '../spec/story.ts';
import { beatsFingerprint, type RecentStructure } from '../memory/fingerprint.ts';
import {
  notesTextOf,
  ORIGINALITY_CODES,
  referenceReuseProblems,
  type ReferenceNames,
} from '../reference/originality.ts';
import type { DirectorPlan } from './plan.ts';
import { exampleNumberIds, incidentSourceIds } from './systems.ts';

/**
 * Deterministic checks on a Director plan (P1C.5), beyond its schema and the spec's own
 * validation: research ids and glossary terms exist, lengths fit the settings, parts are well
 * formed, devices get what they need, the house structure holds (failure or rejected alternative,
 * a hook with a number, the ending) and the plan does not repeat recent videos: their
 * device/layout combos, their structure (hook and main patterns) or the previous one's hook.
 * Pure; the worker runs it with the spec and registry checks, and gate edits can reuse it.
 */

export const DIRECTOR_PROBLEM_CODES = [
  'unknown_fact',
  'too_many_facts_in_beat',
  'too_many_numbers_in_beat',
  'unknown_term',
  'term_before_intro',
  'mixed_system_numbers',
  'too_many_new_terms_in_beat',
  'too_many_new_terms',
  'running_example_missing',
  'target_length_missing',
  'target_length_override',
  'target_length_out_of_range',
  'target_length_mismatch',
  'length_reason_missing',
  'parts_not_allowed',
  'too_many_parts',
  'part_order',
  'unknown_beat',
  'parts_cover_beats',
  'chapter_spans_parts',
  'payoff_in_other_part',
  'chosen_in_other_part',
  'planted_question_missing',
  'hero_metric_missing',
  'chapter_question_missing',
  'incident_source_missing',
  'incident_without_facts',
  'incident_not_in_notes',
  'no_failure_or_alternative',
  'chosen_design_missing',
  'hook_without_number',
  'hook_not_question',
  'hook_too_many_numbers',
  'hook_numbers_in_fact_ids',
  'hook_numbers_off_hook',
  'payoff_too_soon',
  'device_overused',
  'devices_unused',
  'cta_has_number',
  'cta_has_series_label',
  'source_label_bare',
  'number_not_in_notes',
  'ending_kind',
  'spec_card_missing',
  'cta_missing',
  'cliffhanger_missing',
  'recap_missing',
  'recent_combo_reused',
  'structure_repeated',
  'hook_repeated',
  'continues_without_previous',
  'scene_too_long',
  'layout_mode_overused',
  'layout_mode_repeated',
  'pattern_overused',
  // Originality (P1C.11): a reference video's names, examples or title reused.
  ...ORIGINALITY_CODES,
] as const;
export type DirectorProblemCode = (typeof DIRECTOR_PROBLEM_CODES)[number];

export interface DirectorProblem {
  /** JSON path into the plan, e.g. `$.story.beats[2].factIds[0]`. */
  readonly path: string;
  readonly code: DirectorProblemCode;
  readonly message: string;
}

export interface DirectorCheckContext {
  readonly notes: ResearchNotes;
  /** The run's resolved length, parts and level settings. */
  readonly video: VideoSettings;
  /** The run's fixed length (`lengthOverrideSec`); each video or part must plan exactly it. */
  readonly lengthOverrideSec?: number;
  /** `<device>/<layout>` combos used in recent videos (`device_layout` usage). */
  readonly recentCombos: readonly string[];
  /** Recent videos' hooks and main pattern sequences, newest first (`directorMemory`). */
  readonly recentStructures?: readonly RecentStructure[];
  /** The run's series: its name and label may not appear in the CTA (code adds them). */
  readonly series: { readonly name: string; readonly label: string };
  /** Site and library names of the run's sources (`bareSourceNames`), bare as a source line. */
  readonly sourceNames?: readonly string[];
  /** The run's sources, to name them in messages (`mixed_system_numbers`). */
  readonly sources?: readonly {
    readonly sourceId: number;
    readonly title: string | null;
    readonly origin: string;
  }[];
  /**
   * The plan is one part of a multi-part video (a part run's plan, `partPlan`, or its spec seen
   * as a plan): it is checked as that part, so an earlier part ends on its cliffhanger instead
   * of closing the topic, a later part opens with its recap, and what the whole topic needs (a
   * failure or rejected alternative) was checked on the parent's plan.
   */
  readonly part?: PartRef;
  /**
   * Every ready reference's names to avoid (P1C.11, code only): the plan may not reuse a
   * reference's names, examples or title, unless the notes use the name too.
   */
  readonly references?: readonly ReferenceNames[];
}

/** Distinct new glossary terms a whole video (or plan) may introduce, per explanation level. */
export const NEW_TERM_LIMITS: Readonly<Record<ExplanationLevel, number>> = {
  beginner: 3,
  intermediate: 5,
  expert: Number.POSITIVE_INFINITY,
};

/** Research facts (`fact-<n>`) one beat may cite, per explanation level. */
export const MAX_FACTS_PER_BEAT: Readonly<Record<ExplanationLevel, number>> = {
  beginner: BEGINNER_MAX_FACTS_PER_BEAT,
  intermediate: Number.POSITIVE_INFINITY,
  expert: Number.POSITIVE_INFINITY,
};

/** Research numbers (`num-<n>`, hook numbers included) one beat may use, per explanation level. */
export const MAX_NUMBERS_PER_BEAT: Readonly<Record<ExplanationLevel, number>> = {
  beginner: BEGINNER_MAX_NUMBERS_PER_BEAT,
  intermediate: Number.POSITIVE_INFINITY,
  expert: Number.POSITIVE_INFINITY,
};

/**
 * Plan problems that never block (P1C.10): the beat sheet shows them as warnings, and the
 * Director's repair turn lists them without asking for one because of them.
 */
export const DIRECTOR_ADVISORY_CODES: readonly DirectorProblemCode[] = ['hook_repeated'];

const ADVISORY: ReadonlySet<string> = new Set(DIRECTOR_ADVISORY_CODES);

/** Whether a plan issue's code is advisory (`DIRECTOR_ADVISORY_CODES`). */
export function isAdvisoryPlanCode(code: string): boolean {
  return ADVISORY.has(code);
}

/** Beats per plan that may reuse a recent device/layout combo before it is a problem. */
export const MAX_RECENT_COMBO_REUSE = 1;

/** Beats between a planted question and its payoff, at least ("pay it off late"). */
export const MIN_PAYOFF_GAP_BEATS = 2;

/** Beats one device may appear on. */
export const MAX_BEATS_PER_DEVICE = 2;

/** Devices every part needs on its own beat, so a multi-part plan may repeat them. */
const PER_PART_DEVICES: readonly string[] = ['recap_opening', 'cliffhanger_ending'];

/** What each closing ending needs in `story.ending`. */
export const ENDING_REQUIREMENTS: Readonly<
  Record<EndingDevice, { readonly specCard: boolean; readonly cta: boolean }>
> = {
  spec_card_ending: { specCard: true, cta: true },
  callback_ending: { specCard: false, cta: true },
  real_world_closure: { specCard: false, cta: true },
  cliffhanger_ending: { specCard: false, cta: false },
};

type Path = (string | number)[];

const problem = (path: Path, code: DirectorProblemCode, message: string): DirectorProblem => ({
  path: toJsonPath(path),
  code,
  message,
});

/** One video of the plan: the whole story, or one part. */
interface PlannedVideo {
  readonly index: number;
  readonly count: number;
  /** Indices into `story.beats`, in order. */
  readonly beats: readonly number[];
  readonly targetSec: number | undefined;
  readonly targetPath: Path;
  readonly label: string;
}

export function directorPlanProblems(
  plan: DirectorPlan,
  ctx: DirectorCheckContext,
): DirectorProblem[] {
  const videos = plannedVideos(plan, ctx.part);
  return [
    ...factIdProblems(plan, ctx.notes),
    ...factCountProblems(plan, ctx.video.explanationLevel),
    ...numberCountProblems(plan, ctx.notes, ctx.video.explanationLevel),
    ...newTermProblems(plan, ctx),
    ...termBeforeIntroProblems(plan),
    ...mixedSystemProblems(plan, ctx),
    ...sourceLabelProblems(plan, ctx.sourceNames),
    ...runningExampleProblems(plan, ctx.video.explanationLevel),
    ...partStructureProblems(plan, ctx.video),
    ...videos.flatMap((video) => lengthProblems(plan, video, ctx)),
    ...partScopeProblems(plan),
    ...deviceRequirementProblems(plan, ctx.notes),
    ...payoffGapProblems(plan),
    ...deviceReuseProblems(plan),
    ...unusedDeviceProblems(plan),
    ...(ctx.part ? [] : failureOrAlternativeProblems(plan)),
    ...videos.flatMap((video) => hookProblems(plan, video, ctx.notes)),
    ...strayHookNumberProblems(plan, videos),
    ...endingProblems(plan, videos, ctx.part),
    ...ctaProblems(plan, ctx.series),
    ...proseNumberProblems(plan, ctx.notes),
    ...varietyProblems(plan, ctx.recentCombos),
    ...videos.flatMap((video) => historyProblems(plan, video, ctx.recentStructures ?? [])),
    ...videos.flatMap((video) => sceneVarietyProblems(plan, video)),
    ...originalityProblems(plan, ctx),
  ];
}

/** A reference's names in the plan's prose, its title or its source lines (P1C.11). */
function originalityProblems(plan: DirectorPlan, ctx: DirectorCheckContext): DirectorProblem[] {
  if (!ctx.references?.length) return [];
  const texts = [
    { path: '$.meta.title', text: plan.meta.title, isTitle: true },
    ...proseFields(plan).map(([path, text]) => ({ path: toJsonPath(path), text })),
    ...plan.story.beats.flatMap((b, i) =>
      b.source ? [{ path: toJsonPath(['story', 'beats', i, 'source']), text: b.source }] : [],
    ),
    ...(plan.story.ending.cta ? [{ path: '$.story.ending.cta', text: plan.story.ending.cta }] : []),
  ];
  return referenceReuseProblems(texts, {
    references: ctx.references,
    notesText: notesTextOf(ctx.notes),
  });
}

/** The plan's videos: its parts, else the one video (a part of a bigger video when `part`). */
function plannedVideos(plan: DirectorPlan, part?: PartRef): PlannedVideo[] {
  const { beats } = plan.story;
  if (!plan.parts) {
    return [
      {
        index: (part?.index ?? 1) - 1,
        count: part?.count ?? 1,
        beats: beats.map((_, i) => i),
        targetSec: plan.meta.targetLengthSec,
        targetPath: ['meta', 'targetLengthSec'],
        label: part ? `Part ${part.index}` : 'The video',
      },
    ];
  }
  const beatIndex = new Map(beats.map((b, i) => [b.id, i]));
  return plan.parts.map((part, i, parts) => ({
    index: i,
    count: parts.length,
    beats: part.beatIds.flatMap((id) => {
      const index = beatIndex.get(id);
      return index === undefined ? [] : [index];
    }),
    targetSec: part.targetLengthSec,
    targetPath: ['parts', i, 'targetLengthSec'],
    label: `Part ${part.part}`,
  }));
}

function devicesUsed(plan: DirectorPlan): Set<string> {
  const { story } = plan;
  return new Set([...story.devices, ...story.beats.flatMap((b) => (b.device ? [b.device] : []))]);
}

// --- Research ids and terms -------------------------------------------------------------------

function factIdProblems(plan: DirectorPlan, notes: ResearchNotes): DirectorProblem[] {
  const known = new Set([...notes.facts.map((f) => f.id), ...notes.numbers.map((n) => n.id)]);
  const unknown = (path: Path, id: string) =>
    known.has(id)
      ? []
      : [
          problem(
            path,
            'unknown_fact',
            `Unknown research id "${id}". Use only "fact-<n>" and "num-<n>" ids from the research notes.`,
          ),
        ];
  return plan.story.beats.flatMap((beat, i) => [
    ...beat.factIds.flatMap((id, j) => unknown(['story', 'beats', i, 'factIds', j], id)),
    ...(beat.hookNumberIds ?? []).flatMap((id, j) =>
      unknown(['story', 'beats', i, 'hookNumberIds', j], id),
    ),
  ]);
}

/** One idea per beat: a beat cites at most the level's number of facts (numbers aside). */
function factCountProblems(plan: DirectorPlan, level: ExplanationLevel): DirectorProblem[] {
  const limit = MAX_FACTS_PER_BEAT[level];
  return plan.story.beats.flatMap((beat, i) => {
    const facts = beat.factIds.filter((id) => id.startsWith('fact-'));
    if (facts.length <= limit) return [];
    return [
      problem(
        ['story', 'beats', i, 'factIds'],
        'too_many_facts_in_beat',
        `Beat "${beat.id}" cites ${facts.length} facts (${facts.join(', ')}); at the ${level} ` +
          `level a beat cites at most ${limit}, so its narration explains one idea. Keep the ` +
          'facts the beat needs, or split it into two beats.',
      ),
    ];
  });
}

/**
 * The distinct research numbers a beat uses: its `num-*` ids (hook numbers included), each once
 * whatever its value lists, and the research numbers its intent states that no cited id holds
 * (dates and everyday words aside). Keyed by research number, with a label for messages: the
 * id, or the number as the intent writes it.
 */
function beatResearchNumbers(beat: StoryBeat, notes: ResearchNotes): Map<string, string> {
  const index = numberIndex(notes);
  const research = numberValueKeys(notes);
  const ids = [
    ...(beat.hookNumberIds ?? []),
    ...beat.factIds.filter((id) => id.startsWith('num-')),
  ];
  // Each cited number counts once, whatever its value lists ("one, one and three").
  const used = new Map<string, string>(ids.map((id) => [id, id]));
  const cited = new Set(ids.flatMap((id) => [...(index.keysById.get(id) ?? [])]));
  const mentions = numberMentions(beat.intent).filter((m) => !m.everyday);
  const intentKeys = new Set(mentions.map((m) => numberKey(m.value)));
  for (const m of mentions) {
    const key = numberKey(m.value);
    if (!research.has(key) || cited.has(key)) continue;
    const number = researchNumberOf(key, intentKeys, index);
    if (!used.has(number)) used.set(number, `"${m.text}"`);
  }
  return used;
}

/**
 * A beat uses at most the level's number of distinct research numbers: the values of its
 * `num-*` ids (hook numbers included) and the research values its intent states, compared by
 * value (a number the intent states without citing it counts too; dates do not). The intent is
 * what the Scriptwriter narrates, so a number there is a number on screen.
 */
function numberCountProblems(
  plan: DirectorPlan,
  notes: ResearchNotes,
  level: ExplanationLevel,
): DirectorProblem[] {
  const limit = MAX_NUMBERS_PER_BEAT[level];
  if (!Number.isFinite(limit)) return [];
  return plan.story.beats.flatMap((beat, i) => {
    const used = beatResearchNumbers(beat, notes);
    if (used.size <= limit) return [];
    return [
      problem(
        ['story', 'beats', i, 'factIds'],
        'too_many_numbers_in_beat',
        `Beat "${beat.id}" uses ${used.size} research numbers (${[...used.values()].join(', ')}, ` +
          `from its ids and its intent); at the ${level} level a beat uses at most ${limit}, so ` +
          'the viewer can hold them. Keep the numbers the beat turns on, and drop the rest from ' +
          'its ids and its intent.',
      ),
    ];
  });
}

/** Case and spacing do not matter when a beat names a glossary term. */
export function foldTerm(term: string): string {
  return term.trim().replace(/\s+/g, ' ').toLowerCase();
}

function newTermProblems(plan: DirectorPlan, ctx: DirectorCheckContext): DirectorProblem[] {
  const glossary = new Map(ctx.notes.glossary.map((g) => [foldTerm(g.term), g.term]));
  const problems: DirectorProblem[] = [];
  const introduced = new Set<string>();
  plan.story.beats.forEach((beat, i) => {
    if (beat.newTerms.length > 1) {
      problems.push(
        problem(
          ['story', 'beats', i, 'newTerms'],
          'too_many_new_terms_in_beat',
          `Beat "${beat.id}" introduces ${beat.newTerms.length} terms; introduce at most one per beat.`,
        ),
      );
    }
    beat.newTerms.forEach((term, j) => {
      const folded = foldTerm(term);
      if (glossary.has(folded)) {
        introduced.add(folded);
        return;
      }
      problems.push(
        problem(
          ['story', 'beats', i, 'newTerms', j],
          'unknown_term',
          `"${term}" is not in the research glossary. Use a glossary term as written: ` +
            `${[...glossary.values()].join(', ')}.`,
        ),
      );
    });
  });
  const level = ctx.video.explanationLevel;
  const limit = NEW_TERM_LIMITS[level];
  if (introduced.size > limit) {
    const byBeat = plan.story.beats
      .filter((b) => b.newTerms.length > 0)
      .map((b) => `${b.id}: ${b.newTerms.map((t) => `"${t}"`).join(', ')}`)
      .join('; ');
    problems.push(
      problem(
        ['story', 'beats'],
        'too_many_new_terms',
        `The beats introduce ${introduced.size} distinct terms (${byBeat}); at the ${level} ` +
          `level the video introduces at most ${limit}: keep the ${limit} the story depends on; ` +
          'describe the others in plain words without naming them (e.g. "the limiter let ' +
          'everything through").',
      ),
    );
  }
  return problems;
}

/** The plan's texts a beat shows or acts on, by the first beat they appear in. */
function textsByBeat(
  plan: DirectorPlan,
): { beat: number; path: Path; what: string; text: string }[] {
  const { story } = plan;
  const firstBeat = (chapterId: string) => story.beats.findIndex((b) => b.chapterId === chapterId);
  const metric = story.heroMetric;
  return [
    ...story.beats.flatMap((b, i) => [
      { beat: i, path: ['story', 'beats', i, 'intent'], what: 'intent', text: b.intent },
      ...(b.source
        ? [{ beat: i, path: ['story', 'beats', i, 'source'], what: 'source line', text: b.source }]
        : []),
    ]),
    ...story.chapters.flatMap((c, k) =>
      (['title', 'question'] as const).flatMap((field) => {
        const text = c[field];
        const beat = firstBeat(c.id);
        return text && beat >= 0
          ? [{ beat, path: ['story', 'chapters', k, field], what: `chapter ${field}`, text }]
          : [];
      }),
    ),
    ...(metric
      ? (['label', 'value'] as const).map((field) => ({
          beat: 0,
          path: ['story', 'heroMetric', field],
          what: `hero metric ${field}`,
          text: metric[field],
        }))
      : []),
  ];
}

/**
 * A beat relies only on terms introduced in it or earlier: an intent (or a text on screen from
 * that beat: its source line, a chapter title from the chapter's first beat, the hero metric from
 * the first) that names a later beat's new term is flagged. Whole words, any case, plain plural.
 */
function termBeforeIntroProblems(plan: DirectorPlan): DirectorProblem[] {
  const intro = new Map<string, { term: string; beat: number }>();
  plan.story.beats.forEach((b, i) =>
    b.newTerms.forEach((term) => {
      if (!intro.has(foldTerm(term))) intro.set(foldTerm(term), { term, beat: i });
    }),
  );
  const beatId = (i: number) => plan.story.beats[i]!.id;
  return textsByBeat(plan).flatMap(({ beat, path, what, text }) =>
    [...intro.values()]
      .filter((t) => t.beat > beat && containsPhrase(text, t.term, { plural: true }))
      .map((t) =>
        problem(
          path,
          'term_before_intro',
          `Beat "${beatId(beat)}" uses "${t.term}" in its ${what}, but beat "${beatId(t.beat)}" ` +
            `introduces it later: introduce it in the earlier beat or reword this ${what}.`,
        ),
      ),
  );
}

/**
 * One system per story: in a video with a real incident, a beat that cites research numbers from
 * a source the incident beats do not cite (a guide's example, another company) is flagged unless
 * it sets `exampleNumbers`, so the narration labels them as an example.
 */
function mixedSystemProblems(plan: DirectorPlan, ctx: DirectorCheckContext): DirectorProblem[] {
  const incident = incidentSourceIds(plan, ctx.notes);
  const name = (id: number) => {
    const source = ctx.sources?.find((s) => s.sourceId === id);
    return source ? `"${source.title ?? source.origin}"` : `source ${id}`;
  };
  return plan.story.beats.flatMap((beat, i) => {
    if (beat.exampleNumbers) return [];
    return [...exampleNumberIds(beat, ctx.notes, incident)].map(([source, ids]) =>
      problem(
        ['story', 'beats', i, 'factIds'],
        'mixed_system_numbers',
        `Beat "${beat.id}" cites ${ids.join(', ')}: these numbers come from ${name(source)}, ` +
          'not the incident: set exampleNumbers and label them as an example, or use the ' +
          "incident's numbers.",
      ),
    );
  });
}

/** A beat's source line names the publisher and what it is, never a bare name. */
function sourceLabelProblems(plan: DirectorPlan, names: readonly string[] = []): DirectorProblem[] {
  return plan.story.beats.flatMap((b, i) =>
    b.source && isBareSourceLine(b.source, names)
      ? [
          problem(
            ['story', 'beats', i, 'source'],
            'source_label_bare',
            bareSourceMessage(`Beat "${b.id}"'s`, b.source),
          ),
        ]
      : [],
  );
}

function runningExampleProblems(plan: DirectorPlan, level: ExplanationLevel): DirectorProblem[] {
  if (level !== 'beginner' || plan.story.runningExample) return [];
  return [
    problem(
      ['story', 'runningExample'],
      'running_example_missing',
      'At the beginner level, give one concrete running example (one user, one request) in one sentence.',
    ),
  ];
}

// --- Length and parts -------------------------------------------------------------------------

function lengthProblems(
  plan: DirectorPlan,
  video: PlannedVideo,
  ctx: DirectorCheckContext,
): DirectorProblem[] {
  const target = video.targetSec;
  if (target === undefined) {
    return [
      problem(video.targetPath, 'target_length_missing', 'Set meta.targetLengthSec (no parts).'),
    ];
  }
  return [
    ...targetRangeProblems(video, target, ctx),
    ...lengthReasonProblems(plan, video, target, ctx.video.lengthReasonAboveSec),
    ...beatSumProblems(plan, video, target),
  ];
}

function targetRangeProblems(
  video: PlannedVideo,
  target: number,
  ctx: DirectorCheckContext,
): DirectorProblem[] {
  const override = ctx.lengthOverrideSec;
  if (override !== undefined) {
    return target === override
      ? []
      : [
          problem(
            video.targetPath,
            'target_length_override',
            `${video.label} is planned at ${target} s; this run's length is fixed at ${override} s.`,
          ),
        ];
  }
  const { lengthMinSec: min, lengthMaxSec: max } = ctx.video;
  if (target >= min && target <= max) return [];
  return [
    problem(
      video.targetPath,
      'target_length_out_of_range',
      `${video.label} is planned at ${target} s; plan ${min}-${max} s.`,
    ),
  ];
}

function lengthReasonProblems(
  plan: DirectorPlan,
  video: PlannedVideo,
  target: number,
  reasonAbove: number,
): DirectorProblem[] {
  if (target <= reasonAbove || plan.lengthReason) return [];
  return [
    problem(
      ['lengthReason'],
      'length_reason_missing',
      `${video.label} runs ${target} s, over ${reasonAbove} s: give a one-line lengthReason.`,
    ),
  ];
}

function beatSumProblems(plan: DirectorPlan, video: PlannedVideo, target: number) {
  const total = video.beats.reduce((sum, i) => sum + (plan.story.beats[i]?.targetSec ?? 0), 0);
  if (Math.abs(total - target) <= target * TARGET_LENGTH_TOLERANCE) return [];
  const path: Path = plan.parts ? ['parts', video.index, 'beatIds'] : ['story', 'beats'];
  return [
    problem(
      path,
      'target_length_mismatch',
      `${video.label}'s beat targetSec values sum to ${total} s; expected ${target} s ` +
        `±${TARGET_LENGTH_TOLERANCE * 100}%.`,
    ),
  ];
}

function partStructureProblems(plan: DirectorPlan, video: VideoSettings): DirectorProblem[] {
  const parts = plan.parts;
  if (!parts) return [];
  const problems: DirectorProblem[] = [];
  if (!video.allowParts) {
    problems.push(
      problem(['parts'], 'parts_not_allowed', 'Parts are off for this run: plan one video.'),
    );
  }
  if (parts.length > video.maxParts) {
    problems.push(
      problem(
        ['parts'],
        'too_many_parts',
        `${parts.length} parts; plan at most ${video.maxParts}.`,
      ),
    );
  }
  return [...problems, ...partNumberProblems(plan), ...partCoverProblems(plan)];
}

function partNumberProblems(plan: DirectorPlan): DirectorProblem[] {
  return (plan.parts ?? []).flatMap((part, i) =>
    part.part === i + 1
      ? []
      : [
          problem(
            ['parts', i, 'part'],
            'part_order',
            `Part ${i + 1} is numbered ${part.part}; number parts 1, 2, 3 in order.`,
          ),
        ],
  );
}

function partCoverProblems(plan: DirectorPlan): DirectorProblem[] {
  const ids = plan.story.beats.map((b) => b.id);
  const known = new Set(ids);
  const parts = plan.parts ?? [];
  const unknown = parts.flatMap((part, i) =>
    part.beatIds.flatMap((id, j) =>
      known.has(id)
        ? []
        : [problem(['parts', i, 'beatIds', j], 'unknown_beat', `Unknown beat "${id}".`)],
    ),
  );
  const listed = parts.flatMap((p) => p.beatIds).filter((id) => known.has(id));
  const covers = listed.length === ids.length && listed.every((id, i) => id === ids[i]);
  if (covers) return unknown;
  return [
    ...unknown,
    problem(
      ['parts'],
      'parts_cover_beats',
      `Parts must list every story beat exactly once, in story order: ${ids.join(', ')}.`,
    ),
  ];
}

/** In a multi-part plan, a chapter, a planted question or an alternative stays inside one part. */
function partScopeProblems(plan: DirectorPlan): DirectorProblem[] {
  if (!plan.parts) return [];
  const partOf = new Map(plan.parts.flatMap((p) => p.beatIds.map((id) => [id, p.part])));
  const { story } = plan;
  const problems = story.chapters.flatMap((chapter, i) => {
    const parts = new Set(
      story.beats.filter((b) => b.chapterId === chapter.id).map((b) => partOf.get(b.id)),
    );
    return parts.size > 1
      ? [
          problem(
            ['story', 'chapters', i],
            'chapter_spans_parts',
            `Chapter "${chapter.id}" has beats in several parts; each part is its own video.`,
          ),
        ]
      : [];
  });
  const question = story.plantedQuestion;
  if (question && partOf.get(question.beatId) !== partOf.get(question.payoffBeatId)) {
    problems.push(
      problem(
        ['story', 'plantedQuestion', 'payoffBeatId'],
        'payoff_in_other_part',
        'The planted question and its payoff must be in the same part.',
      ),
    );
  }
  const alternative = story.rejectedAlternative;
  if (
    alternative?.chosenBeatId !== undefined &&
    partOf.get(alternative.beatId) !== partOf.get(alternative.chosenBeatId)
  ) {
    problems.push(
      problem(
        ['story', 'rejectedAlternative', 'chosenBeatId'],
        'chosen_in_other_part',
        'The rejected alternative and the chosen design must be in the same part.',
      ),
    );
  }
  return problems;
}

// --- Devices ----------------------------------------------------------------------------------

function deviceRequirementProblems(plan: DirectorPlan, notes: ResearchNotes): DirectorProblem[] {
  const used = devicesUsed(plan);
  const { story } = plan;
  const problems: DirectorProblem[] = [];
  if (used.has('planted_question') && !story.plantedQuestion) {
    problems.push(
      problem(
        ['story', 'plantedQuestion'],
        'planted_question_missing',
        'planted_question is used: fill plantedQuestion with its beat and payoff beat.',
      ),
    );
  }
  if (used.has('hero_metric') && !story.heroMetric) {
    problems.push(
      problem(
        ['story', 'heroMetric'],
        'hero_metric_missing',
        'hero_metric is used: fill heroMetric.',
      ),
    );
  }
  if (used.has('question_chapters')) problems.push(...chapterQuestionProblems(plan));
  return [...problems, ...incidentProblems(plan, notes)];
}

function chapterQuestionProblems(plan: DirectorPlan): DirectorProblem[] {
  return plan.story.chapters.flatMap((chapter, i) =>
    chapter.question
      ? []
      : [
          problem(
            ['story', 'chapters', i, 'question'],
            'chapter_question_missing',
            `question_chapters is used: give chapter "${chapter.id}" its question.`,
          ),
        ],
  );
}

function incidentProblems(plan: DirectorPlan, notes: ResearchNotes): DirectorProblem[] {
  const hasIncident = notes.failureModes.some((f) => f.kind === 'incident');
  return plan.story.beats.flatMap((beat, i) => {
    if (beat.device !== 'real_incident') return [];
    const path: Path = ['story', 'beats', i];
    return [
      ...(hasIncident
        ? []
        : [
            problem(
              [...path, 'device'],
              'incident_not_in_notes',
              'The research notes hold no incident; never invent one. Pick another device.',
            ),
          ]),
      ...(beat.source
        ? []
        : [
            problem(
              [...path, 'source'],
              'incident_source_missing',
              `Beat "${beat.id}" shows a real incident: set source (publisher and date from the notes).`,
            ),
          ]),
      ...(beat.factIds.length > 0
        ? []
        : [
            problem(
              [...path, 'factIds'],
              'incident_without_facts',
              `Beat "${beat.id}" shows a real incident: cite the dated facts it uses.`,
            ),
          ]),
    ];
  });
}

/** At least once: a failure before the fix, or a rejected alternative before the chosen design. */
function failureOrAlternativeProblems(plan: DirectorPlan): DirectorProblem[] {
  const alternative = plan.story.rejectedAlternative;
  if (alternative) {
    return alternative.chosenBeatId === undefined
      ? [
          problem(
            ['story', 'rejectedAlternative', 'chosenBeatId'],
            'chosen_design_missing',
            'Name the beat that shows the chosen design (chosenBeatId), after the alternative.',
          ),
        ]
      : [];
  }
  if (devicesUsed(plan).has('failure_before_fix')) return [];
  return [
    problem(
      ['story'],
      'no_failure_or_alternative',
      'Show a failure before the fix (failure_before_fix) or a rejectedAlternative before the chosen design.',
    ),
  ];
}

/** A video's hook: its first beat after any recap. */
function hookIndexOf(plan: DirectorPlan, video: PlannedVideo): number | undefined {
  return video.beats.find((i) => plan.story.beats[i]?.device !== 'recap_opening');
}

/**
 * Each video's hook keeps its numbers in `hookNumberIds`, never in `factIds`, and opens the way
 * `story.hook.kind` says: a `problem` names one or two research numbers (the schema caps them)
 * when the notes have numbers; a `puzzle` asks the question the mechanism answers (its intent
 * has a "?") with at most `MAX_PUZZLE_HOOK_NUMBERS` research number. The topic class plays no
 * part: either kind suits any topic.
 */
function hookProblems(
  plan: DirectorPlan,
  video: PlannedVideo,
  notes: ResearchNotes,
): DirectorProblem[] {
  const hookIndex = hookIndexOf(plan, video);
  const hook = hookIndex === undefined ? undefined : plan.story.beats[hookIndex];
  if (hookIndex === undefined || !hook) return [];
  const path: Path = ['story', 'beats', hookIndex];
  const problems: DirectorProblem[] = [];
  const inFacts = hook.factIds.filter((id) => id.startsWith('num-'));
  if (inFacts.length > 0) {
    problems.push(
      problem(
        [...path, 'factIds'],
        'hook_numbers_in_fact_ids',
        `${video.label}'s hook "${hook.id}" lists numbers in factIds (${inFacts.join(', ')}): ` +
          `put its one or two numbers in hookNumberIds (at most ${MAX_HOOK_NUMBERS}) and drop the rest.`,
      ),
    );
  }
  if (plan.story.hook.kind === 'puzzle')
    return [...problems, ...puzzleHookProblems(hook, path, video, notes)];
  if (notes.numbers.length > 0 && !hook.hookNumberIds?.length) {
    problems.push(
      problem(
        [...path, 'hookNumberIds'],
        'hook_without_number',
        `${video.label}'s hook "${hook.id}" names no research number: an engineer's problem with a real number (hookNumberIds: "num-<n>").`,
      ),
    );
  }
  return problems;
}

/** A puzzle hook is a question, with a number only when the number is the puzzle. */
function puzzleHookProblems(
  hook: StoryBeat,
  path: Path,
  video: PlannedVideo,
  notes: ResearchNotes,
): DirectorProblem[] {
  const where = `${video.label}'s hook "${hook.id}"`;
  const numbers = beatResearchNumbers(hook, notes);
  return [
    ...(hook.intent.includes('?')
      ? []
      : [
          problem(
            [...path, 'intent'],
            'hook_not_question',
            `${where} is a puzzle hook (story.hook.kind "puzzle"): phrase its intent as the ` +
              'question the mechanism answers, ending in "?". Or set kind "problem" and give it ' +
              'one or two research numbers.',
          ),
        ]),
    ...(numbers.size > MAX_PUZZLE_HOOK_NUMBERS
      ? [
          problem(
            [...path, 'hookNumberIds'],
            'hook_too_many_numbers',
            `${where} is a puzzle hook with ${numbers.size} research numbers ` +
              `(${[...numbers.values()].join(', ')}); a puzzle uses at most ` +
              `${MAX_PUZZLE_HOOK_NUMBERS}, and only if the number is the puzzle. Keep one, or set ` +
              'kind "problem".',
          ),
        ]
      : []),
  ];
}

/** `hookNumberIds` belong to hooks only. */
function strayHookNumberProblems(
  plan: DirectorPlan,
  videos: readonly PlannedVideo[],
): DirectorProblem[] {
  const hooks = new Set(videos.map((v) => hookIndexOf(plan, v)));
  return plan.story.beats.flatMap((beat, i) =>
    beat.hookNumberIds && !hooks.has(i)
      ? [
          problem(
            ['story', 'beats', i, 'hookNumberIds'],
            'hook_numbers_off_hook',
            `Beat "${beat.id}" is not a hook: cite its numbers in factIds, not hookNumberIds.`,
          ),
        ]
      : [],
  );
}

/** The payoff comes late: at least `MIN_PAYOFF_GAP_BEATS` beats after the planted question. */
function payoffGapProblems(plan: DirectorPlan): DirectorProblem[] {
  const question = plan.story.plantedQuestion;
  if (!question) return [];
  const index = (id: string) => plan.story.beats.findIndex((b) => b.id === id);
  const planted = index(question.beatId);
  const payoff = index(question.payoffBeatId);
  // Unknown beats and a payoff before the question are spec errors.
  if (planted < 0 || payoff <= planted || payoff - planted >= MIN_PAYOFF_GAP_BEATS) return [];
  return [
    problem(
      ['story', 'plantedQuestion', 'payoffBeatId'],
      'payoff_too_soon',
      `The payoff "${question.payoffBeatId}" comes right after the question in "${question.beatId}"; ` +
        `pay it off at least ${MIN_PAYOFF_GAP_BEATS} beats later.`,
    ),
  ];
}

/** Every device the story lists is used on at least one beat (where it shows). */
function unusedDeviceProblems(plan: DirectorPlan): DirectorProblem[] {
  const onBeats = new Set(plan.story.beats.flatMap((b) => (b.device ? [b.device] : [])));
  return plan.story.devices.flatMap((device, i) =>
    onBeats.has(device)
      ? []
      : [
          problem(
            ['story', 'devices', i],
            'devices_unused',
            `"${device}" is listed in story.devices but on no beat: set it as the device of the ` +
              'beat where it shows, or remove it from story.devices.',
          ),
        ],
  );
}

/** One device on at most `MAX_BEATS_PER_DEVICE` beats (per-part recaps and cliffhangers aside). */
function deviceReuseProblems(plan: DirectorPlan): DirectorProblem[] {
  const seen = new Map<string, number>();
  return plan.story.beats.flatMap((beat, i) => {
    if (!beat.device || PER_PART_DEVICES.includes(beat.device)) return [];
    const count = (seen.get(beat.device) ?? 0) + 1;
    seen.set(beat.device, count);
    if (count <= MAX_BEATS_PER_DEVICE) return [];
    return [
      problem(
        ['story', 'beats', i, 'device'],
        'device_overused',
        `"${beat.device}" is already on ${MAX_BEATS_PER_DEVICE} beats; use another device or none here.`,
      ),
    ];
  });
}

// --- Endings ----------------------------------------------------------------------------------

const isEndingDevice = (kind: string): kind is EndingDevice =>
  (ENDING_DEVICES as readonly string[]).includes(kind);

function endingProblems(
  plan: DirectorPlan,
  videos: readonly PlannedVideo[],
  part: PartRef | undefined,
): DirectorProblem[] {
  // An earlier part ends on its cliffhanger (`partPlan`): only the last part closes the topic.
  const closes = !part || part.index === part.count;
  return [
    ...(closes ? closingEndingProblems(plan) : []),
    ...(plan.parts || part ? partEdgeProblems(plan, videos) : []),
  ];
}

/** The single video, or the last part, closes with a closing ending and what it needs. */
function closingEndingProblems(plan: DirectorPlan): DirectorProblem[] {
  const ending = plan.story.ending;
  if (!isEndingDevice(ending.kind)) return [];
  if (ending.kind === 'cliffhanger_ending') {
    const closing = ENDING_DEVICES.filter((d) => d !== 'cliffhanger_ending');
    return [
      problem(
        ['story', 'ending', 'kind'],
        'ending_kind',
        `The ${plan.parts ? 'last part' : 'video'} closes the topic: use ${closing.join(', ')} ` +
          '(spec_card_ending is the house ending).',
      ),
    ];
  }
  const needs = ENDING_REQUIREMENTS[ending.kind];
  return [
    ...(needs.specCard && !ending.specCard
      ? [
          problem(
            ['story', 'ending', 'specCard'],
            'spec_card_missing',
            `${ending.kind} needs a specCard with 3 short lines summarising the design.`,
          ),
        ]
      : []),
    ...(needs.cta && !ending.cta
      ? [
          problem(
            ['story', 'ending', 'cta'],
            'cta_missing',
            `${ending.kind} needs a cta: a share or follow line in our own words.`,
          ),
        ]
      : []),
  ];
}

/** Earlier parts end on cliffhanger_ending; parts 2+ open with recap_opening. */
function partEdgeProblems(plan: DirectorPlan, videos: readonly PlannedVideo[]): DirectorProblem[] {
  const { beats } = plan.story;
  return videos.flatMap((video) => {
    const first = video.beats[0];
    const last = video.beats.at(-1);
    const problems: DirectorProblem[] = [];
    if (video.index > 0 && first !== undefined && beats[first]?.device !== 'recap_opening') {
      problems.push(
        problem(
          ['story', 'beats', first, 'device'],
          'recap_missing',
          `${video.label} opens with a recap: give beat "${beats[first]?.id}" the device recap_opening.`,
        ),
      );
    }
    const isLast = video.index === video.count - 1;
    if (!isLast && last !== undefined && beats[last]?.device !== 'cliffhanger_ending') {
      problems.push(
        problem(
          ['story', 'beats', last, 'device'],
          'cliffhanger_missing',
          `${video.label} ends on a cliffhanger: give beat "${beats[last]?.id}" the device cliffhanger_ending.`,
        ),
      );
    }
    return problems;
  });
}

/** The share line is our words only: code adds the series label and number. */
function ctaProblems(
  plan: DirectorPlan,
  series: DirectorCheckContext['series'],
): DirectorProblem[] {
  const cta = plan.story.ending.cta;
  if (!cta) return [];
  const path: Path = ['story', 'ending', 'cta'];
  const problems: DirectorProblem[] = [];
  if (/\d/.test(cta)) {
    problems.push(
      problem(
        path,
        'cta_has_number',
        'The cta has digits; code adds the series number. Remove them.',
      ),
    );
  }
  // Whole words: the AI label must not match "explain", "again" or "email".
  const named = [series.label, series.name].find((s) => containsPhrase(cta, s));
  if (named) {
    problems.push(
      problem(
        path,
        'cta_has_series_label',
        `The cta names the series ("${named}"); code adds it next to the spec card. Remove it.`,
      ),
    );
  }
  return problems;
}

/**
 * The plan's prose, with its paths: everything the model writes in words that viewers may see or
 * later agents copy (beat intents, the hook among them; questions, summaries, titles, the running
 * example, the hero metric and the spec card).
 */
function proseFields(plan: DirectorPlan): [Path, string][] {
  const { story } = plan;
  const fields: [Path, string | undefined][] = [
    ...story.beats.map((b, i): [Path, string] => [['story', 'beats', i, 'intent'], b.intent]),
    [['story', 'plantedQuestion', 'text'], story.plantedQuestion?.text],
    [['story', 'rejectedAlternative', 'summary'], story.rejectedAlternative?.summary],
    ...story.chapters.flatMap((c, i): [Path, string | undefined][] => [
      [['story', 'chapters', i, 'title'], c.title],
      [['story', 'chapters', i, 'question'], c.question],
    ]),
    [['story', 'runningExample'], story.runningExample],
    [['story', 'heroMetric', 'label'], story.heroMetric?.label],
    [['story', 'heroMetric', 'value'], story.heroMetric?.value],
    [['story', 'heroMetric', 'storyClock', 'from'], story.heroMetric?.storyClock?.from],
    [['story', 'heroMetric', 'storyClock', 'to'], story.heroMetric?.storyClock?.to],
    ...(story.ending.specCard?.lines ?? []).map((line, i): [Path, string] => [
      ['story', 'ending', 'specCard', 'lines', i],
      line,
    ]),
  ];
  return fields.flatMap(([path, text]) => (text ? [[path, text] as [Path, string]] : []));
}

/**
 * Number tokens the notes state as values: every `numbers[].value`, plus the dates the notes give
 * (a number's `asOf`, an incident's date), so a dated incident can be named. Compared as the
 * Researcher's `number_not_in_source` does (`quantityTokens`: identifiers such as p99, IPv4 or
 * HTTP 429 are skipped; grouping commas ignored).
 */
function noteNumberTokens(notes: ResearchNotes): Set<string> {
  const texts = [
    ...notes.numbers.flatMap((n) => [n.value, n.asOf ?? '']),
    ...notes.failureModes.map((f) => f.incident?.date ?? ''),
  ];
  return new Set(texts.flatMap((t) => quantityTokens(t).map(normalizeNumber)));
}

/** Every number in the plan's prose is a research value as written: none derived or invented. */
function proseNumberProblems(plan: DirectorPlan, notes: ResearchNotes): DirectorProblem[] {
  const listed = noteNumberTokens(notes);
  return proseFields(plan).flatMap(([path, text]) => {
    const missing = [
      ...new Set(quantityTokens(text).filter((t) => !listed.has(normalizeNumber(t)))),
    ];
    return missing.map((token) =>
      problem(
        path,
        'number_not_in_notes',
        `"${token}" is not a research number value. Use numbers from the notes as written; ` +
          'never derive one (no products, sums or conversions), or leave the number out.',
      ),
    );
  });
}

// --- Variety ----------------------------------------------------------------------------------

/** `<device>/<layout>` for a beat that names both. */
export function deviceLayoutCombo(beat: { device?: string; layoutMode?: string }) {
  return beat.device && beat.layoutMode ? `${beat.device}/${beat.layoutMode}` : undefined;
}

function varietyProblems(plan: DirectorPlan, recentCombos: readonly string[]): DirectorProblem[] {
  const recent = new Set(recentCombos);
  const reused = plan.story.beats.flatMap((beat, i) => {
    const combo = deviceLayoutCombo(beat);
    return combo && recent.has(combo) ? [{ i, beat, combo }] : [];
  });
  if (reused.length <= MAX_RECENT_COMBO_REUSE) return [];
  return reused.map(({ i, beat, combo }) =>
    problem(
      ['story', 'beats', i],
      'recent_combo_reused',
      `Beat "${beat.id}" repeats the recently used device/layout "${combo}"; ` +
        `${reused.length} beats do, at most ${MAX_RECENT_COMBO_REUSE} may. Change its device or layout mode.`,
    ),
  );
}

/**
 * A video (or part) against the usage history: the same hook and main pattern sequence as any
 * recent video is `structure_repeated`; else the previous video's hook is `hook_repeated`
 * (advisory). Endings are never compared: the house ending is meant to repeat.
 */
function historyProblems(
  plan: DirectorPlan,
  video: PlannedVideo,
  recent: readonly RecentStructure[],
): DirectorProblem[] {
  const hookIndex = hookIndexOf(plan, video);
  if (recent.length === 0 || hookIndex === undefined) return [];
  const beats = video.beats.flatMap((i) => plan.story.beats[i] ?? []);
  const { hook, patternSequence } = beatsFingerprint(beats, plan.story.hook.kind);
  if (!hook) return [];
  const path: Path = ['story', 'beats', hookIndex];
  const same = patternSequence
    ? recent.find((r) => r.hooks.includes(hook) && r.sequences.includes(patternSequence))
    : undefined;
  if (same) {
    return [
      problem(
        path,
        'structure_repeated',
        `${video.label} has the structure of the recent video ${videoName(same)}: the same hook ` +
          `(${hook}, hook.kind and this beat's device) and the same main patterns ` +
          `(${patternSequence}). Open with another device or hook kind, or show the mechanism ` +
          'with other patterns.',
      ),
    ];
  }
  const previous = recent[0];
  if (!previous?.hooks.includes(hook)) return [];
  return [
    problem(
      path,
      'hook_repeated',
      `${video.label} opens with the hook of the previous video ${videoName(previous)} ` +
        `(${hook}, hook.kind and this beat's device). Prefer another device or hook kind.`,
    ),
  ];
}

const videoName = (video: RecentStructure): string =>
  video.title ? `"${video.title}"` : '(untitled)';

/** One scene of a video: a beat that starts a board and the beats that continue it. */
interface PlannedScene {
  /** Index into `story.beats` of the scene's first beat. */
  readonly first: number;
  /** Its layout mode: the first beat's (continuing beats keep the board's). */
  readonly layoutMode: string | undefined;
  /** Indices into `story.beats` of all its beats, in order. */
  readonly beats: number[];
}

/** A video's scenes, `continuesPrevious` chains counted as one. Its first beat always starts one. */
function scenesOf(plan: DirectorPlan, video: PlannedVideo): PlannedScene[] {
  const scenes: PlannedScene[] = [];
  video.beats.forEach((i, k) => {
    const beat = plan.story.beats[i];
    if (!beat) return;
    const current = scenes.at(-1);
    if (k > 0 && beat.continuesPrevious && current) current.beats.push(i);
    else scenes.push({ first: i, layoutMode: beat.layoutMode, beats: [i] });
  });
  return scenes;
}

/**
 * Per video: no beat continues across the video's start; a layout mode lays out at most
 * `MAX_SCENES_PER_LAYOUT_MODE` scenes and never two scenes in a row; a pattern is suggested on at
 * most `MAX_BEATS_PER_PATTERN` beats.
 */
function sceneVarietyProblems(plan: DirectorPlan, video: PlannedVideo): DirectorProblem[] {
  const scenes = scenesOf(plan, video);
  return [
    ...firstBeatContinuesProblems(plan, video),
    ...sceneLengthProblems(plan, scenes),
    ...layoutOveruseProblems(plan, video, scenes),
    ...layoutRepeatProblems(plan, scenes),
    ...patternOveruseProblems(plan, video),
  ];
}

function firstBeatContinuesProblems(plan: DirectorPlan, video: PlannedVideo): DirectorProblem[] {
  const first = video.beats[0];
  const beat = first === undefined ? undefined : plan.story.beats[first];
  if (!beat?.continuesPrevious) return [];
  return [
    problem(
      ['story', 'beats', first!, 'continuesPrevious'],
      'continues_without_previous',
      `Beat "${beat.id}" opens ${video.label.toLowerCase()}: it starts a board, so continuesPrevious is false.`,
    ),
  ];
}

/** A scene spans at most `MAX_BEATS_PER_SCENE` beats: one board cannot carry a whole video. */
function sceneLengthProblems(
  plan: DirectorPlan,
  scenes: readonly PlannedScene[],
): DirectorProblem[] {
  return scenes.flatMap((scene) => {
    const extra = scene.beats.slice(MAX_BEATS_PER_SCENE);
    const first = plan.story.beats[scene.first]?.id;
    return extra.map((i) =>
      problem(
        ['story', 'beats', i, 'continuesPrevious'],
        'scene_too_long',
        `Beat "${plan.story.beats[i]?.id}" would make the scene that starts at "${first}" span ` +
          `${scene.beats.length} beats; a scene spans at most ${MAX_BEATS_PER_SCENE}. Start a new ` +
          'scene here (continuesPrevious false, with its own layout mode).',
      ),
    );
  });
}

function layoutOveruseProblems(
  plan: DirectorPlan,
  video: PlannedVideo,
  scenes: readonly PlannedScene[],
): DirectorProblem[] {
  const seen = new Map<string, number>();
  return scenes.flatMap((scene) => {
    if (!scene.layoutMode) return [];
    const count = (seen.get(scene.layoutMode) ?? 0) + 1;
    seen.set(scene.layoutMode, count);
    if (count <= MAX_SCENES_PER_LAYOUT_MODE) return [];
    return [
      problem(
        ['story', 'beats', scene.first, 'layoutMode'],
        'layout_mode_overused',
        `${video.label} already lays out ${MAX_SCENES_PER_LAYOUT_MODE} scenes with ` +
          `"${scene.layoutMode}"; pick another mode for beat "${plan.story.beats[scene.first]?.id}", ` +
          'or continue the previous scene (continuesPrevious).',
      ),
    ];
  });
}

function layoutRepeatProblems(
  plan: DirectorPlan,
  scenes: readonly PlannedScene[],
): DirectorProblem[] {
  return scenes.flatMap((scene, k) => {
    const previous = scenes[k - 1];
    if (!scene.layoutMode || previous?.layoutMode !== scene.layoutMode) return [];
    return [
      problem(
        ['story', 'beats', scene.first, 'layoutMode'],
        'layout_mode_repeated',
        `Beat "${plan.story.beats[scene.first]?.id}" starts a new scene in "${scene.layoutMode}", ` +
          'the mode of the scene before it: pick another mode, or continue that scene ' +
          '(continuesPrevious).',
      ),
    ];
  });
}

function patternOveruseProblems(plan: DirectorPlan, video: PlannedVideo): DirectorProblem[] {
  const seen = new Map<string, number>();
  return video.beats.flatMap((i) =>
    (plan.story.beats[i]?.suggestedPatternIds ?? []).flatMap((pattern, j) => {
      const count = (seen.get(pattern) ?? 0) + 1;
      seen.set(pattern, count);
      if (count <= MAX_BEATS_PER_PATTERN) return [];
      return [
        problem(
          ['story', 'beats', i, 'suggestedPatternIds', j],
          'pattern_overused',
          `${video.label} already suggests "${pattern}" on ${MAX_BEATS_PER_PATTERN} beats; ` +
            'show this beat another way.',
        ),
      ];
    }),
  );
}
