import { ENDING_DEVICES, type EndingDevice } from '../catalogues/devices.ts';
import type { ExplanationLevel, VideoSettings } from '../config/video.ts';
import type { ResearchNotes } from '../research/notes.ts';
import { TARGET_LENGTH_TOLERANCE } from '../spec/integrity/warnings.ts';
import { toJsonPath } from '../spec/validate.ts';
import type { DirectorPlan } from './plan.ts';

/**
 * Deterministic checks on a Director plan (P1C.5), beyond its schema and the spec's own
 * validation: research ids and glossary terms exist, lengths fit the settings, parts are well
 * formed, devices get what they need, the house structure holds (failure or rejected alternative,
 * a hook with a number, the ending) and the plan does not repeat recent device/layout combos.
 * Pure; the worker runs it with the spec and registry checks, and gate edits can reuse it.
 */

export const DIRECTOR_PROBLEM_CODES = [
  'unknown_fact',
  'unknown_term',
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
  'ending_kind',
  'spec_card_missing',
  'cta_missing',
  'cliffhanger_missing',
  'recap_missing',
  'recent_combo_reused',
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
}

/** Distinct new glossary terms a whole video (or plan) may introduce, per explanation level. */
export const NEW_TERM_LIMITS: Readonly<Record<ExplanationLevel, number>> = {
  beginner: 3,
  intermediate: 5,
  expert: Number.POSITIVE_INFINITY,
};

/** Beats per plan that may reuse a recent device/layout combo before it is a problem. */
export const MAX_RECENT_COMBO_REUSE = 1;

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
  const videos = plannedVideos(plan);
  return [
    ...factIdProblems(plan, ctx.notes),
    ...newTermProblems(plan, ctx),
    ...runningExampleProblems(plan, ctx.video.explanationLevel),
    ...partStructureProblems(plan, ctx.video),
    ...videos.flatMap((video) => lengthProblems(plan, video, ctx)),
    ...partScopeProblems(plan),
    ...deviceRequirementProblems(plan, ctx.notes),
    ...failureOrAlternativeProblems(plan),
    ...videos.flatMap((video) => hookProblems(plan, video, ctx.notes)),
    ...endingProblems(plan, videos),
    ...varietyProblems(plan, ctx.recentCombos),
  ];
}

function plannedVideos(plan: DirectorPlan): PlannedVideo[] {
  const { beats } = plan.story;
  if (!plan.parts) {
    return [
      {
        index: 0,
        count: 1,
        beats: beats.map((_, i) => i),
        targetSec: plan.meta.targetLengthSec,
        targetPath: ['meta', 'targetLengthSec'],
        label: 'The video',
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
  return plan.story.beats.flatMap((beat, i) =>
    beat.factIds.flatMap((id, j) =>
      known.has(id)
        ? []
        : [
            problem(
              ['story', 'beats', i, 'factIds', j],
              'unknown_fact',
              `Unknown research id "${id}". Use only "fact-<n>" and "num-<n>" ids from the research notes.`,
            ),
          ],
    ),
  );
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
    problems.push(
      problem(
        ['story', 'beats'],
        'too_many_new_terms',
        `The beats introduce ${introduced.size} distinct terms (${[...introduced].join(', ')}); ` +
          `at the ${level} level the video introduces at most ${limit}.`,
      ),
    );
  }
  return problems;
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

/** Each video's hook (its first beat after any recap) uses a research number, when there are any. */
function hookProblems(
  plan: DirectorPlan,
  video: PlannedVideo,
  notes: ResearchNotes,
): DirectorProblem[] {
  if (notes.numbers.length === 0) return [];
  const hookIndex = video.beats.find((i) => plan.story.beats[i]?.device !== 'recap_opening');
  const hook = hookIndex === undefined ? undefined : plan.story.beats[hookIndex];
  if (!hook || hook.factIds.some((id) => id.startsWith('num-'))) return [];
  return [
    problem(
      ['story', 'beats', hookIndex!, 'factIds'],
      'hook_without_number',
      `${video.label}'s hook "${hook.id}" cites no research number: an engineer's problem with a real number ("num-<n>").`,
    ),
  ];
}

// --- Endings ----------------------------------------------------------------------------------

const isEndingDevice = (kind: string): kind is EndingDevice =>
  (ENDING_DEVICES as readonly string[]).includes(kind);

function endingProblems(plan: DirectorPlan, videos: readonly PlannedVideo[]): DirectorProblem[] {
  return [...closingEndingProblems(plan), ...partEdgeProblems(plan, videos)];
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
  if (!plan.parts) return [];
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
