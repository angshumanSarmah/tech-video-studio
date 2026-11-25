import {
  DIRECTOR_PROBLEM_CODES,
  SCRIPT_PROBLEM_CODES,
  SPEC_WARNING_CODES,
  directorPlanProblems,
  hookNumberRepeats,
  planOfSpec,
  readabilityProblems,
  scriptProblems,
  timedLengthProblems,
  validateRenderableVideoSpec,
  type BeatPauses,
  type CodeIssue,
  type CuratorOwner,
  type DirectorProblemCode,
  type ExplanationLevel,
  type IncidentSource,
  type IssueSeverity,
  type RenderableVideoSpec,
  type ResearchNotes,
  type RecentStructure,
  type ScriptProblemCode,
  type SpecError,
  type VideoSettings,
} from '@explainer-studio/shared';
import { hudTextWarnings } from '../hud/hud-text-checks.ts';
import { onScreenTextWarnings, TEXT_TOO_SMALL_ON_SCREEN } from '../layout/on-screen-text.ts';
import { specLayoutWarnings } from '../layout/spec-layout.ts';
import { TEXT_TRUNCATED } from '../layout/text-fit.ts';
import { LAYOUT_WARNING_CODES } from '../layout/types.ts';
import { SUBTITLE_WORD_TOO_WIDE, subtitleWarnings } from '../subtitles/subtitle-checks.ts';
import type { Theme } from '../theme/index.ts';
import { beatCheckWarnings } from './beat-checks.ts';
import { colourWarnings } from './colour-checks.ts';
import { layerWarnings } from './layer-checks.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';
import { screenTextWarnings, sourceMissingOnScreenWarnings } from './screen-checks.ts';
import { withRegistryChecks } from './validate.ts';
import { TERM_SHOWN_LATE, termShownLateWarnings } from './term-checks.ts';
import { patternVarietyWarnings } from './variety-checks.ts';

/**
 * The Curator's deterministic part (P1C.8): every code check, run together on a finished spec
 * (the re-timed spec after the Generator, or a gate edit), each finding with the agent that owns
 * it and how serious it is. Validation errors are always blocking, and then nothing else runs
 * (the other checks assume a valid spec). Otherwise:
 * - the spec's and registry's warnings; the layout's, with the chain-level `text_too_small`
 *   replaced by what each beat shows after its camera (`text_too_small_on_screen`); HUD text,
 *   subtitles; the Generator's beat, screen-text and cross-board checks; colour meaning; a source
 *   line for numbers on screen; pattern variety against recent videos;
 * - the plan checks on the spec seen as a plan (`planOfSpec`), as the part it is when it is
 *   one (`meta.part`), less what only a plan has (its planned length, a parts plan); the script checks, less the word budgets once the spec is timed
 *   (the measured length replaces them);
 * - the measured length after TTS, the hook's numbers said again, and reading ease.
 * Findings are de-duplicated by path and code. Pure.
 */

export type CuratorCheckContext = {
  theme: Theme;
  registries?: Registries;
  notes: ResearchNotes;
  /** The run's topic title (the script's main term when the title names no glossary term). */
  topicTitle: string;
  series: { name: string; label: string };
  channelHandle: string | null;
  /** The run's resolved video settings (length range, level, pace). */
  video: VideoSettings;
  lengthOverrideSec?: number;
  /** The run's resolved pauses (`beatGapSec`, `landingSec`), as the Scriptwriter's budgets use. */
  pauses: BeatPauses;
  /** What the last exported videos used (`directorMemory`); structures for the history checks. */
  recent: {
    combos: readonly string[];
    patterns: readonly string[];
    structures?: readonly RecentStructure[];
  };
  sourceNames?: readonly string[];
  sources?: readonly IncidentSource[];
};

/**
 * Plan checks about what a spec does not have: its planned length (measured instead), a parts
 * plan. A part run's spec knows its part (`meta.part`), so its recap and cliffhanger are checked.
 */
const PLAN_ONLY_CODES: readonly DirectorProblemCode[] = [
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
];

/** Word budgets: estimates the measured length replaces once the spec is timed. */
const BUDGET_CODES: readonly ScriptProblemCode[] = [
  'narration_over_budget',
  'narration_under_budget',
];

/**
 * Warnings that stop gate 3's auto-approve and go to the repair loop: text the viewer cannot
 * read or that is hidden, script items and numbers not shown as written, beats far over their
 * length, the hook retold, numbers or facts not in the notes, and missing attribution.
 * Everything else is advisory. Errors are always blocking.
 */
export const BLOCKING_WARNING_CODES = [
  TEXT_TOO_SMALL_ON_SCREEN,
  TEXT_TRUNCATED,
  'overlap',
  'text_covered',
  'avoid_zone',
  'pin_unresolved',
  'overlay_overlap',
  'script_text_missing',
  'script_text_changed',
  'screen_number_not_in_notes',
  'source_missing_on_screen',
  'beat_over_target',
  'video_out_of_range',
  'hook_number_repeated',
  'number_not_in_notes',
  'digits_in_narration',
  'stat_card_not_a_number',
  'stat_card_value_mismatch',
  'source_missing',
  'example_tied_to_incident',
  'unknown_fact',
  'mixed_system_numbers',
  'incident_not_in_notes',
  'incident_source_missing',
] as const;

/** Every other warning a check here can raise (a test keeps this list complete). */
const OTHER_WARNING_CODES: readonly string[] = [
  ...SPEC_WARNING_CODES,
  // Registry and timeline checks (`withRegistryChecks`).
  'child_before_container',
  'recover_without_reject',
  'release_without_lock',
  'scan_too_short',
  'draw_cut_short',
  'route_moves_exceed_stops',
  'morph_without_change',
  'pattern_format_mismatch',
  'pattern_layout_conflict',
  ...LAYOUT_WARNING_CODES,
  SUBTITLE_WORD_TOO_WIDE,
  // The Generator's beat, cross-board and screen-text checks.
  'focus_missing',
  'beat_without_motion',
  'beat_without_change',
  'zoom_from_unplanned',
  'element_without_enter',
  'events_share_word',
  'events_under_ending_card',
  'board_too_busy',
  'highlight_everything',
  'pattern_repeated_on_focus',
  'static_beats',
  'label_term_too_early',
  // Curator-only checks.
  'focus_colour_off_focus',
  'ok_element_rejected',
  'pattern_recently_used',
  'video_over_target',
  'readability_low',
  TERM_SHOWN_LATE,
  ...SCRIPT_PROBLEM_CODES,
  ...DIRECTOR_PROBLEM_CODES.filter((code) => !PLAN_ONLY_CODES.includes(code)),
];

const BLOCKING: ReadonlySet<string> = new Set(BLOCKING_WARNING_CODES);

/** Severity of every warning code the Curator's checks raise. */
export const CURATOR_CODE_POLICY: Readonly<Record<string, IssueSeverity>> = Object.fromEntries([
  ...OTHER_WARNING_CODES.filter((code) => !BLOCKING.has(code)).map(
    (code): [string, IssueSeverity] => [code, 'advisory'],
  ),
  ...BLOCKING_WARNING_CODES.map((code): [string, IssueSeverity] => [code, 'blocking']),
]);

/** Codes whose severity depends on the run's level (they report clarity, which blocks at beginner). */
export const LEVEL_CODE_POLICY: Readonly<
  Record<string, Readonly<Record<ExplanationLevel, IssueSeverity>>>
> = {
  [TERM_SHOWN_LATE]: { beginner: 'blocking', intermediate: 'advisory', expert: 'advisory' },
};

/** A warning code's severity at a level. */
export function codeSeverity(code: string, level: ExplanationLevel): IssueSeverity {
  return LEVEL_CODE_POLICY[code]?.[level] ?? CURATOR_CODE_POLICY[code] ?? 'advisory';
}

/** Who changes what a path points at: boards are the Generator's, script and timing the Scriptwriter's, the rest the plan's. */
export function ownerOfPath(path: string): CuratorOwner {
  if (path.startsWith('$.scenes')) return 'generator';
  if (path.startsWith('$.script') || path.startsWith('$.timing')) return 'scriptwriter';
  return 'director';
}

export function curatorCodeChecks(
  spec: RenderableVideoSpec,
  ctx: CuratorCheckContext,
): CodeIssue[] {
  const registries = ctx.registries ?? DEFAULT_REGISTRIES;
  const result = withRegistryChecks(validateRenderableVideoSpec(spec), spec, registries);
  const errors = result.errors.map((e) => issue(e, 'blocking'));
  const level = ctx.video.explanationLevel;
  if (!result.ok) return dedupe([...errors, ...warningIssues(result.warnings, level)]);
  const valid = result.spec;
  return dedupe(
    warningIssues(
      [
        ...result.warnings,
        ...renderedWarnings(valid, ctx, registries),
        ...boardWarnings(valid, ctx, registries),
        ...storyWarnings(valid, ctx),
      ],
      level,
    ),
  );
}

/** What the video draws: layout (after each beat's camera), HUD text and subtitles. */
function renderedWarnings(
  spec: RenderableVideoSpec,
  ctx: CuratorCheckContext,
  registries: Registries,
): SpecError[] {
  const { theme } = ctx;
  return [
    ...specLayoutWarnings(spec, theme, registries).filter((w) => w.code !== 'text_too_small'),
    ...onScreenTextWarnings(spec, theme, registries),
    ...hudTextWarnings(spec, theme, {
      seriesLabel: ctx.series.label,
      channelHandle: ctx.channelHandle,
    }),
    ...subtitleWarnings(spec, theme),
  ];
}

/** The Generator's checks, colour, attribution of numbers on screen and pattern variety. */
function boardWarnings(
  spec: RenderableVideoSpec,
  ctx: CuratorCheckContext,
  registries: Registries,
): SpecError[] {
  return [
    ...beatCheckWarnings(spec, { registries, theme: ctx.theme }),
    ...screenTextWarnings(spec, { notes: ctx.notes, registries }),
    ...layerWarnings(spec),
    ...colourWarnings(spec, registries),
    ...sourceMissingOnScreenWarnings(spec, ctx.notes, registries),
    ...patternVarietyWarnings(spec, ctx.recent.patterns),
    ...termShownLateWarnings(spec, registries),
  ];
}

/** Plan and script checks on the finished spec, the measured length, hook numbers, reading ease. */
function storyWarnings(spec: RenderableVideoSpec, ctx: CuratorCheckContext): SpecError[] {
  const plan = planOfSpec(spec);
  const { notes, video, sourceNames, sources } = ctx;
  const planned = directorPlanProblems(plan, {
    notes,
    video,
    ...(ctx.lengthOverrideSec !== undefined ? { lengthOverrideSec: ctx.lengthOverrideSec } : {}),
    recentCombos: ctx.recent.combos,
    ...(ctx.recent.structures ? { recentStructures: ctx.recent.structures } : {}),
    series: ctx.series,
    ...(sourceNames ? { sourceNames } : {}),
    ...(sources ? { sources } : {}),
    ...(spec.meta.part ? { part: spec.meta.part } : {}),
  }).filter((p) => !PLAN_ONLY_CODES.includes(p.code));
  const measured = spec.timing !== undefined;
  const scripted = scriptProblems(
    { script: spec.script },
    {
      plan,
      notes,
      topicTitle: ctx.topicTitle,
      level: video.explanationLevel,
      wordsPerSec: video.wordsPerSec,
      pauses: ctx.pauses,
      ...(sourceNames ? { sourceNames } : {}),
      ...(sources ? { sources } : {}),
    },
  ).filter((p) => !(measured && BUDGET_CODES.includes(p.code)));
  return [
    ...planned,
    ...scripted,
    ...timedLengthProblems(spec, {
      video,
      ...(ctx.lengthOverrideSec !== undefined ? { lengthOverrideSec: ctx.lengthOverrideSec } : {}),
    }),
    ...hookNumberRepeats(spec, notes),
    ...readabilityProblems(spec, video.explanationLevel),
  ];
}

function warningIssues(warnings: readonly SpecError[], level: ExplanationLevel): CodeIssue[] {
  return warnings.map((w) => issue(w, codeSeverity(w.code, level)));
}

function issue(error: SpecError, severity: IssueSeverity): CodeIssue {
  return { ...error, severity, owner: ownerOfPath(error.path) };
}

function dedupe(issues: readonly CodeIssue[]): CodeIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.path} ${i.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
