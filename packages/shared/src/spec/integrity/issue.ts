/**
 * A problem found after the spec's structure has parsed. Errors make the spec invalid; warnings
 * do not (see the VideoSpec section of CLAUDE.md for how each caller treats them).
 */
export interface SpecIssue {
  path: (string | number)[];
  code: SpecIssueCode;
  message: string;
}

export const SPEC_ERROR_CODES = [
  'duplicate_id',
  'unknown_reference',
  'missing_beat',
  'beat_order',
  'chapter_order',
  'empty_chapter',
  'payoff_not_after_question',
  'too_many_formula_cards',
  'continues_without_previous',
  'invalid_zoom_from',
  'anchor_out_of_range',
  'unsupported_action',
  'clock_keyframe_order',
  'timing_overlap',
  'timing_word_count',
  'timing_word_outside_beat',
  'timing_end_before_beats',
] as const;
export type SpecErrorCode = (typeof SPEC_ERROR_CODES)[number];

/**
 * `unknown_asset` is raised by the renderer's registry checks (`withRegistryChecks`): an id
 * that is neither in the asset library nor a declared logo slot.
 */
export const SPEC_WARNING_CODES = [
  'target_length_mismatch',
  'transition_on_continuing_beat',
  'unknown_asset',
] as const;
export type SpecWarningCode = (typeof SPEC_WARNING_CODES)[number];

export type SpecIssueCode = SpecErrorCode | SpecWarningCode;

/** Issues for every id that appears more than once; `pathOf(i)` locates item `i`. */
export function findDuplicateIds(
  ids: readonly string[],
  pathOf: (index: number) => SpecIssue['path'],
): SpecIssue[] {
  const seen = new Set<string>();
  const issues: SpecIssue[] = [];
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      issues.push({ path: pathOf(index), code: 'duplicate_id', message: `Duplicate id "${id}".` });
    }
    seen.add(id);
  });
  return issues;
}

export function unknownReference(path: SpecIssue['path'], what: string, id: string): SpecIssue {
  return { path, code: 'unknown_reference', message: `Unknown ${what} "${id}".` };
}
