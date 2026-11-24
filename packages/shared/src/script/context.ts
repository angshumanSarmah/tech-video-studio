import type { ExplanationLevel } from '../config/video.ts';
import type { DirectorPlan } from '../director/plan.ts';
import type { ResearchNotes } from '../research/notes.ts';
import type { BeatScript } from '../spec/script.ts';
import { toJsonPath } from '../spec/validate.ts';
import type { IncidentSource } from './incident-names.ts';

/** What the Scriptwriter checks share: problem codes, the context they run in, path helpers. */

export const SCRIPT_PROBLEM_CODES = [
  'narration_over_budget',
  'narration_under_budget',
  'sentence_too_long',
  'numbers_per_sentence',
  'numbers_per_beat',
  'digits_in_narration',
  'number_not_in_notes',
  'stat_card_not_a_number',
  'stat_card_value_mismatch',
  'stat_card_not_spoken',
  'stat_cards_per_beat',
  'stat_cards_per_video',
  'tag_repeats_stat_card',
  'too_many_tags_continuing',
  'headline_not_concept',
  'headline_repeated',
  'hook_number_missing',
  'new_term_missing',
  'new_term_too_early',
  'topic_not_defined',
  'example_not_labelled',
  'example_tied_to_incident',
  'source_missing',
  'source_changed',
  'source_label_bare',
] as const;
export type ScriptProblemCode = (typeof SCRIPT_PROBLEM_CODES)[number];

export interface ScriptProblem {
  /** JSON path into the output, e.g. `$.script[2].narration`. */
  readonly path: string;
  readonly code: ScriptProblemCode;
  readonly message: string;
}

/** Pauses on the narration track that a beat's planned seconds also cover. */
export interface BeatPauses {
  readonly beatGapSec: number;
  readonly landingSec: number;
}

/**
 * A script to check: the Scriptwriter's output, or any script layer (a gate edit, or an answer
 * that fails the output schema's stricter limits, so one repair covers both).
 */
export interface ScriptToCheck {
  readonly script: readonly BeatScript[];
}

export interface ScriptCheckContext {
  readonly plan: DirectorPlan;
  readonly notes: ResearchNotes;
  /** The run's topic title: the main term when `meta.title` names no glossary term. */
  readonly topicTitle: string;
  readonly level: ExplanationLevel;
  readonly wordsPerSec: number;
  readonly pauses: BeatPauses;
  /** Site and library names of the run's sources (`bareSourceNames`), bare as a source line. */
  readonly sourceNames?: readonly string[];
  /** The run's sources: the incident's titles name its organisation (`incidentNames`). */
  readonly sources?: readonly IncidentSource[];
}

export type Path = (string | number)[];

export const problem = (path: Path, code: ScriptProblemCode, message: string): ScriptProblem => ({
  path: toJsonPath(path),
  code,
  message,
});

/** The beat ids of each video the plan makes: each part's, or the whole story's. */
export function planVideos(plan: DirectorPlan): string[][] {
  return plan.parts?.map((p) => p.beatIds) ?? [plan.story.beats.map((b) => b.id)];
}

/** `"..."`, cut to 60 characters, for quoting narration in messages. */
export const quoted = (text: string) =>
  text.length > 60 ? `"${text.slice(0, 57)}..."` : `"${text}"`;
