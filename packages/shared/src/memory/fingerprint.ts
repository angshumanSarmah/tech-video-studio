import { z } from 'zod';
import type { DirectorPlan } from '../director/plan.ts';
import type { HookKind } from '../spec/story.ts';

/**
 * A video's structure as the usage history records it (P1C.10): how it opens (its hook) and its
 * main pattern sequence. A plan's comes from its suggestions, an exported spec's from what its
 * boards draw (`usageOfSpec`, renderer). Two videos with both the same are the same structure
 * (`structure_repeated`). Pure.
 */

/** Distinct patterns, in order, that make a video's main sequence. */
export const MAIN_SEQUENCE_PATTERNS = 3;

/** Distinct patterns a video needs before it has a sequence (one pattern is not a structure). */
export const MIN_SEQUENCE_PATTERNS = 2;

/** The separator in a pattern sequence value (`a>b>c`). */
export const SEQUENCE_SEPARATOR = '>';

export interface VideoFingerprint {
  /** `<hook kind>/<device>` of the video's hook beat; absent when that beat has no device. */
  readonly hook?: string;
  /** Its first `MAIN_SEQUENCE_PATTERNS` distinct patterns, `a>b>c`; absent under two. */
  readonly patternSequence?: string;
}

/** A video's hook beat: its first beat that is not a recap of the part before. */
export function hookBeatOf<B extends { readonly device?: string | undefined }>(
  beats: readonly B[],
): B | undefined {
  return beats.find((b) => b.device !== 'recap_opening');
}

/** `<hook kind>/<device>` of the hook beat (no kind: `problem`, as older plans parse). */
export function hookKey(
  kind: HookKind | undefined,
  beats: readonly { readonly device?: string | undefined }[],
): string | undefined {
  const device = hookBeatOf(beats)?.device;
  return device ? `${kind ?? 'problem'}/${device}` : undefined;
}

/** The first `MAIN_SEQUENCE_PATTERNS` distinct pattern ids, in order; undefined under two. */
export function mainPatternSequence(patternIds: readonly string[]): string | undefined {
  const distinct = [...new Set(patternIds)].slice(0, MAIN_SEQUENCE_PATTERNS);
  return distinct.length >= MIN_SEQUENCE_PATTERNS ? distinct.join(SEQUENCE_SEPARATOR) : undefined;
}

/** A run of story beats (one video's, in order) as a fingerprint, from its suggested patterns. */
export function beatsFingerprint(
  beats: readonly {
    readonly device?: string | undefined;
    readonly suggestedPatternIds?: readonly string[] | undefined;
  }[],
  hookKind: HookKind | undefined,
): VideoFingerprint {
  const hook = hookKey(hookKind, beats);
  const patternSequence = mainPatternSequence(beats.flatMap((b) => b.suggestedPatternIds ?? []));
  return { ...(hook ? { hook } : {}), ...(patternSequence ? { patternSequence } : {}) };
}

/** One fingerprint per video the plan makes: each part in order, else the whole story. */
export function planFingerprint(plan: DirectorPlan): VideoFingerprint[] {
  const { beats, hook } = plan.story;
  if (!plan.parts) return [beatsFingerprint(beats, hook.kind)];
  const byId = new Map(beats.map((b) => [b.id, b]));
  return plan.parts.map((part) =>
    beatsFingerprint(
      part.beatIds.flatMap((id) => {
        const beat = byId.get(id);
        return beat ? [beat] : [];
      }),
      hook.kind,
    ),
  );
}

/**
 * A recent video's structure, as the Director and the Curator read it: one per video (a
 * multi-part video's parts together), newest first. Its title names it in messages.
 */
export const RecentStructureSchema = z.strictObject({
  title: z.string().nullable(),
  /** Each part's hook (one for a single video). */
  hooks: z.array(z.string()),
  /** Each part's main pattern sequence that has one. */
  sequences: z.array(z.string()),
});
export type RecentStructure = z.infer<typeof RecentStructureSchema>;
