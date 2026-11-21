import { z } from 'zod';
import { SpecIdSchema } from './ids.ts';
import { SourceLineSchema } from './script.ts';

/** Story layer, written by the Director. Device, layout, pattern and world ids are catalogue ids. */

/** The story clock's value (story-time seconds) at the start of a beat. */
export const StoryClockKeyframeSchema = z.strictObject({
  beatId: SpecIdSchema.describe(
    'A beat after the first one: never the first beat, whose value is startValue.',
  ),
  value: z.number().min(0),
});
export type StoryClockKeyframe = z.infer<typeof StoryClockKeyframeSchema>;

/**
 * A running clock in story time, e.g. "ORDER → DOORBELL · 1:52". Values are seconds of story time,
 * shown as m:ss. It runs from `startValue` at the first beat's start to `endValue` at the last
 * beat's end, linearly through any keyframes in between.
 */
export const StoryClockSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  startValue: z.number().min(0),
  endValue: z.number().min(0),
  /** Optional pacing: in story order, never on the first beat (that is `startValue`). */
  keyframes: z
    .array(StoryClockKeyframeSchema)
    .default([])
    .describe('Optional pacing, in story order. Never on the first beat: its value is startValue.'),
});
export type StoryClock = z.infer<typeof StoryClockSchema>;

/**
 * About how many characters the hero metric's label and value hold together, in the default
 * theme: its row less the dimension's ticks and lines and a step marker of 5 dots. A renderer
 * test recomputes it (`roomInChars`). A hint for prompts.
 */
export const HERO_METRIC_MAX_CHARS = 46;

const heroMetricText = `label and value together at most about ${HERO_METRIC_MAX_CHARS} characters`;

/** A pinned pill such as "iPhone 17 · 3.5 min", with an optional story clock. */
export const HeroMetricSchema = z.strictObject({
  label: z.string().min(1).describe(`What the number measures, short: ${heroMetricText}.`),
  /** Display value, kept as text so units and formatting survive. */
  value: z
    .string()
    .min(1)
    .describe(`One research number as written, with its unit: ${heroMetricText}.`),
  storyClock: StoryClockSchema.optional(),
});
export type HeroMetric = z.infer<typeof HeroMetricSchema>;

/**
 * About how many characters of a chapter title the HUD shows without cutting it, in the default
 * theme: the narrowest place a title appears (the card viewport's label cell; the step name has
 * more room), with nothing sharing its row. A renderer test recomputes it (`roomInChars`). A hint
 * for prompts: `hudTextWarnings` measures the real text.
 */
export const CHAPTER_TITLE_MAX_CHARS = 28;

export const ChapterSchema = z.strictObject({
  id: SpecIdSchema,
  title: z
    .string()
    .min(1)
    .describe(
      `Short chapter title shown in the HUD: at most about ${CHAPTER_TITLE_MAX_CHARS} characters, or it is cut off.`,
    ),
  /** Question form of the title, for question-driven chapters. */
  question: z
    .string()
    .min(1)
    .optional()
    .describe('The title as a viewer question; required on every chapter with question_chapters.'),
});
export type Chapter = z.infer<typeof ChapterSchema>;

/** Scenes (a beat plus the beats that continue it) one layout mode may lay out, per video. */
export const MAX_SCENES_PER_LAYOUT_MODE = 2;

/** Beats one scene (a beat and the beats that continue it) may span. */
export const MAX_BEATS_PER_SCENE = 3;

/** Beats one pattern may be suggested on, per video. */
export const MAX_BEATS_PER_PATTERN = 2;

/** Research facts (`fact-<n>` ids) one beat may cite at the beginner level: one idea per beat. */
export const BEGINNER_MAX_FACTS_PER_BEAT = 3;

/**
 * Research numbers one beat may use at the beginner level (distinct values of its `num-<n>` ids,
 * `hookNumberIds` and the numbers its intent states): a viewer holds two per beat, not four.
 */
export const BEGINNER_MAX_NUMBERS_PER_BEAT = 2;

/** Research numbers a hook may cite (`hookNumberIds`): one or two make the problem, not a list. */
export const MAX_HOOK_NUMBERS = 2;

export const StoryBeatSchema = z.strictObject({
  id: SpecIdSchema,
  chapterId: SpecIdSchema,
  intent: z
    .string()
    .min(1)
    .describe('One sentence: what the viewer sees change in this beat, and why it matters.'),
  device: SpecIdSchema.optional().describe('A narrative device id from the catalogue.'),
  targetSec: z.number().positive().describe('Planned seconds of this beat.'),
  /** Research fact ids this beat relies on (resolved against research notes in P1C.5). */
  factIds: z
    .array(SpecIdSchema)
    .default([])
    .describe(
      `Ids of the research facts ("fact-<n>") and numbers ("num-<n>") this beat uses. At the beginner level at most ${BEGINNER_MAX_FACTS_PER_BEAT} "fact-<n>" ids and ${BEGINNER_MAX_NUMBERS_PER_BEAT} research numbers per beat (its "num-<n>" ids, hookNumberIds and any number its intent states, together): one idea, not everything the notes say.`,
    ),
  /**
   * The hook beat only (a video's first beat after any recap): the research numbers that make
   * the problem. Its `factIds` then hold no `num-*` ids, so the cap cannot be bypassed.
   */
  hookNumberIds: z
    .array(z.string().regex(/^num-[1-9]\d*$/, 'Use "num-<n>".'))
    .min(1)
    .max(MAX_HOOK_NUMBERS)
    .optional()
    .describe(
      'Hook beat only: the one or two research numbers ("num-<n>") that make the engineer\'s problem. The hook\'s factIds then list no "num-<n>" ids.',
    ),
  /**
   * Suggestion for the Generator: this beat keeps the previous beat's board and adds to it (one
   * scene). Never on a video's (or part's) first beat.
   */
  continuesPrevious: z
    .boolean()
    .default(false)
    .describe(
      `true: this beat keeps the previous beat's board and adds to it (one scene). Never on a video's or part's first beat; a scene spans at most ${MAX_BEATS_PER_SCENE} beats.`,
    ),
  /** Suggestion for the Generator, which makes the final choice in the scene layer. */
  layoutMode: SpecIdSchema.optional().describe(
    `A layout mode id allowed for the video's topic class, on the scene's first beat (continuing beats leave it unset). One mode lays out at most ${MAX_SCENES_PER_LAYOUT_MODE} scenes per video, and the next scene never repeats the previous scene's mode.`,
  ),
  /** Suggestions for the Generator, which makes the final choice in the scene layer. */
  suggestedPatternIds: z
    .array(SpecIdSchema)
    .default([])
    .describe(
      `Pattern ids from the catalogue that show this beat; the Generator decides. One pattern on at most ${MAX_BEATS_PER_PATTERN} beats per video.`,
    ),
  /** Glossary terms this beat introduces (the first time the video names them). */
  newTerms: z
    .array(z.string().trim().min(1))
    .default([])
    .describe(
      'Glossary terms (exactly as the research glossary writes them) this beat introduces: at most one per beat.',
    ),
  /**
   * Source line for a beat that shows a real incident or a sourced number; the Scriptwriter
   * carries it into `script[].source`.
   */
  source: SourceLineSchema.optional().describe(
    'Footnote for a real-incident beat, e.g. "<publisher> post-incident report, <date>", from the notes.',
  ),
});
export type StoryBeat = z.infer<typeof StoryBeatSchema>;

export const PlantedQuestionSchema = z.strictObject({
  text: z.string().min(1),
  /** Beat that plants the question. */
  beatId: SpecIdSchema,
  /** Beat that answers it; must come after `beatId`. */
  payoffBeatId: SpecIdSchema.describe('The beat that answers it; after beatId.'),
});
export type PlantedQuestion = z.infer<typeof PlantedQuestionSchema>;

export const RejectedAlternativeSchema = z.strictObject({
  /** Beat that shows the rejected alternative. */
  beatId: SpecIdSchema.describe('The beat that shows the rejected alternative.'),
  summary: z.string().min(1),
  /** Beat that shows the chosen design; must come after `beatId`. */
  chosenBeatId: SpecIdSchema.optional().describe(
    'The beat that shows the chosen design instead; after beatId.',
  ),
});
export type RejectedAlternative = z.infer<typeof RejectedAlternativeSchema>;

/** Characters per spec card line. */
export const SPEC_CARD_LINE_MAX = 40;

/** The house ending: three short lines that summarise the design. */
export const SpecCardSchema = z.strictObject({
  lines: z
    .array(z.string().trim().min(1).max(SPEC_CARD_LINE_MAX))
    .length(3)
    .describe('Exactly 3 short lines summarising the design, e.g. "<example-spec-line>".'),
});
export type SpecCard = z.infer<typeof SpecCardSchema>;

export const EndingSchema = z.strictObject({
  /** An ending device (`ENDING_DEVICES`). */
  kind: SpecIdSchema.describe(
    'An ending device id: spec_card_ending, callback_ending, real_world_closure or cliffhanger_ending.',
  ),
  cta: z.string().min(1).optional().describe('The closing share or follow line, in our own words.'),
  specCard: SpecCardSchema.optional(),
  /** The series number shown with the spec card ("System Design #12"); filled by code. */
  seriesNumber: z.number().int().positive().optional(),
});
export type Ending = z.infer<typeof EndingSchema>;

export const MissingPrimitiveRequestSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  /** Primitive or pattern id used instead. */
  fallbackUsed: SpecIdSchema.describe('The primitive or pattern id used instead.'),
});
export type MissingPrimitiveRequest = z.infer<typeof MissingPrimitiveRequestSchema>;

/** How a video opens: on an engineer's problem with numbers, or on the question a mechanism answers. */
export const HOOK_KINDS = ['problem', 'puzzle'] as const;
export const HookKindSchema = z.enum(HOOK_KINDS);
export type HookKind = z.infer<typeof HookKindSchema>;

/** Research numbers a puzzle hook may use: a number only when the number is the puzzle. */
export const MAX_PUZZLE_HOOK_NUMBERS = 1;

export const HookSchema = z.strictObject({
  kind: HookKindSchema.default('problem').describe(
    `Always set it. "problem": a system under load or an incident; the hook beat names one or two research numbers in hookNumberIds (at most ${MAX_HOOK_NUMBERS}). "puzzle": the mechanism itself is the interesting part; the hook beat's intent is the question the mechanism answers, ending in "?", with at most ${MAX_PUZZLE_HOOK_NUMBERS} research number and only if the number is the puzzle.`,
  ),
});
export type Hook = z.infer<typeof HookSchema>;

/** Characters in `story.runningExample`. */
export const RUNNING_EXAMPLE_MAX = 200;

export const StoryLayerSchema = z.strictObject({
  devices: z.array(SpecIdSchema).default([]).describe('Narrative device ids for the whole video.'),
  /** How the hook opens; plans and specs from before hook kinds parse as `problem`. */
  hook: HookSchema.describe(
    'How the video opens. Set hook.kind on every plan: "problem" or "puzzle".',
  ).prefault({}),
  metaphorWorld: SpecIdSchema.optional().describe('At most one metaphor world id.'),
  heroMetric: HeroMetricSchema.optional(),
  /** The one concrete example (one user, one request) the video follows throughout. */
  runningExample: z
    .string()
    .trim()
    .min(1)
    .max(RUNNING_EXAMPLE_MAX)
    .optional()
    .describe(
      'One sentence: the concrete example followed all the way through (one user, one request): a concrete situation in plain words; no ids, keys or numbers unless they are research numbers.',
    ),
  chapters: z.array(ChapterSchema).min(1),
  beats: z.array(StoryBeatSchema).min(1),
  plantedQuestion: PlantedQuestionSchema.optional(),
  rejectedAlternative: RejectedAlternativeSchema.optional(),
  ending: EndingSchema,
  missingPrimitiveRequests: z.array(MissingPrimitiveRequestSchema).default([]),
});
export type StoryLayer = z.infer<typeof StoryLayerSchema>;
