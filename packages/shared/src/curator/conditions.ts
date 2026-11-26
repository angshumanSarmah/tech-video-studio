import type { ResearchNotes } from '../research/notes.ts';
import type { CodeIssue } from './issue.ts';

/**
 * Conditions a research number holds under (pure; `claim_drops_condition`). A number's context
 * can say when it is true ("Throughput a store delivers when using pipelining"): a claim that
 * states the number without the condition says more than the notes do (run 1's b1: "a million
 * requests per second" with no pipelining). A condition is a clause from a marker word (when,
 * whenever, if, unless, using, without) to the end of its phrase; it is stated when the
 * claim's sentence or its restatement (`restates.claim`) names one of its key words, matched by
 * stem, so a narration in other words passes once the Curator's restatement names it.
 */

export const CLAIM_DROPS_CONDITION = 'claim_drops_condition';

export interface NumberCondition {
  /** The clause as the context writes it ("when using pipelining"). */
  readonly text: string;
  /** Its key word stems ("pipelin"). */
  readonly stems: readonly string[];
}

/**
 * Words that open a condition. Not "with" or "under": in a number's context they name a party
 * or a scope as often as a condition ("with the payment provider", "under the same tokenizer").
 */
const MARKERS = new Set(['when', 'whenever', 'if', 'unless', 'using', 'without']);

/** Words that carry no condition of their own. */
const FILLER = new Set([
  ...MARKERS,
  'a',
  'an',
  'the',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'for',
  'and',
  'or',
  'is',
  'are',
  'be',
  'been',
  'it',
  'its',
  'their',
  'them',
  'that',
  'this',
  'these',
  'those',
  'source',
  'enabled',
  'used',
  'use',
]);

/** A rough stem: lower case, one plural or verb ending off ("pipelining" → "pipelin"). */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 4) return w;
  return w.replace(/(ing|ed|es|s|e)$/, '');
}

const wordsOf = (text: string) => text.match(/[A-Za-z][A-Za-z-]*/g) ?? [];

/** The conditions a number's context names, in order. */
export function numberConditions(context: string): NumberCondition[] {
  return context.split(/[,.;:()!?]/).flatMap((phrase): NumberCondition[] => {
    const words = phrase.trim().split(/\s+/).filter(Boolean);
    const start = words.findIndex((w) => MARKERS.has(w.toLowerCase()));
    if (start < 0) return [];
    const clause = words.slice(start);
    const stems = [
      ...new Set(
        clause
          .flatMap((w) => wordsOf(w).flatMap((part) => part.split('-')))
          .filter((w) => !FILLER.has(w.toLowerCase()))
          .map(stem),
      ),
    ];
    return stems.length > 0 ? [{ text: clause.join(' '), stems }] : [];
  });
}

/** Whether any of the texts names one of the condition's key words. */
export function conditionStated(condition: NumberCondition, texts: readonly string[]): boolean {
  const said = new Set(
    texts.flatMap((t) =>
      wordsOf(t)
        .flatMap((w) => w.split('-'))
        .map(stem),
    ),
  );
  return condition.stems.some((s) => said.has(s));
}

export interface DroppedCondition {
  readonly numberId: string;
  readonly condition: NumberCondition;
}

/**
 * The conditions of the cited numbers that neither the claim's sentence nor its restatement
 * states. Ids that are not numbers, or not in the notes, have none.
 */
export function droppedConditions(
  ids: readonly string[],
  texts: readonly string[],
  notes: ResearchNotes,
): DroppedCondition[] {
  return ids.flatMap((id) => {
    const number = notes.numbers.find((n) => n.id === id);
    if (!number) return [];
    return numberConditions(number.context)
      .filter((condition) => !conditionStated(condition, texts))
      .map((condition) => ({ numberId: id, condition }));
  });
}

/** "num-2 holds only when using pipelining" (one per dropped condition, joined). */
export function droppedConditionText(dropped: readonly DroppedCondition[]): string {
  return dropped.map((d) => `${d.numberId} holds only ${d.condition.text}`).join('; ');
}

/** A claim as the claims pass answers it (the fields this check reads). */
export interface AuditedClaim {
  readonly beatId: string;
  readonly source: 'narration' | 'value';
  readonly text: string;
  readonly verdict: string;
  readonly ids: readonly string[];
  readonly restates?: { readonly claim: string } | null | undefined;
}

/**
 * What the review's verifier could not get fixed (its last attempt is soft): each narration claim
 * still marked supported that drops a cited number's condition, as a blocking code issue on its
 * beat's narration for the Scriptwriter. Deterministic: it reads the audit, not the model's issues.
 */
export function claimConditionIssues(
  claims: readonly AuditedClaim[],
  notes: ResearchNotes,
  script: readonly { readonly beatId: string }[],
): CodeIssue[] {
  const seen = new Set<string>();
  return claims.flatMap((claim): CodeIssue[] => {
    if (claim.verdict !== 'supported' || claim.source !== 'narration') return [];
    const i = script.findIndex((s) => s.beatId === claim.beatId);
    if (i < 0) return [];
    const texts = [claim.text, claim.restates?.claim ?? ''];
    const dropped = droppedConditions(claim.ids, texts, notes);
    const key = `${claim.beatId}|${claim.text}`;
    if (dropped.length === 0 || seen.has(key)) return [];
    seen.add(key);
    return [
      {
        path: `$.script[${i}].narration`,
        code: CLAIM_DROPS_CONDITION,
        message:
          `Beat "${claim.beatId}" says "${claim.text}", but ${droppedConditionText(dropped)}: ` +
          'say the condition (in any words), or drop the number.',
        severity: 'blocking',
        owner: 'scriptwriter',
      },
    ];
  });
}
