import { z } from 'zod';
import { MemoryRuleScopeSchema, type MemoryRuleScope } from '../domain/library.ts';
import { containsPhrase } from '../text/phrase.ts';
import { MAX_RULE_CHARS, MAX_RULE_WORDS, normalizeRuleText } from './rules.ts';

/**
 * The Analyst's answer (P1C.10): at most one style rule from a reviewer's gate note, or why not.
 * Checked in code (`analystProblems`): one short sentence that names nothing of this video.
 * Pure.
 */

/** Why a note gives no rule. */
export const NO_RULE_REASONS = ['one_off', 'duplicate', 'unsafe', 'unclear'] as const;
export const NoRuleReasonSchema = z.enum(NO_RULE_REASONS);
export type NoRuleReason = z.infer<typeof NoRuleReasonSchema>;

export const AnalystOutputSchema = z.strictObject({
  rule: z
    .strictObject({
      text: z
        .string()
        .trim()
        .min(1)
        .max(MAX_RULE_CHARS)
        .describe(
          `One imperative sentence of at most ${MAX_RULE_WORDS} words, on one line, that names nothing of this video.`,
        ),
      scope: MemoryRuleScopeSchema.describe('The one scope whose output the note is about.'),
      why: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .describe('One line: the preference in the note this rule generalises.'),
    })
    .nullable()
    .describe('The proposed rule, or null when the note gives none (then set noRule).'),
  noRule: z
    .strictObject({
      reason: NoRuleReasonSchema.describe(
        'one_off: only about this video; duplicate: an existing rule already says it (or contradicts it); unsafe: it would hide errors, skip checks or lower accuracy; unclear: the note does not say what to change.',
      ),
      detail: z.string().trim().min(1).max(300).describe('One line: why, in plain words.'),
      duplicateOf: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('The id of the EXISTING RULES rule it repeats or contradicts.'),
    })
    .optional()
    .describe('Set only when rule is null.'),
});
export type AnalystOutput = z.infer<typeof AnalystOutputSchema>;

export const ANALYST_PROBLEM_CODES = [
  'rule_and_no_rule',
  'no_rule_reason_missing',
  'rule_too_long',
  'rule_multi_sentence',
  'rule_names_video',
  'unknown_rule',
] as const;
export type AnalystProblemCode = (typeof ANALYST_PROBLEM_CODES)[number];

export interface AnalystProblem {
  readonly path: string;
  readonly code: AnalystProblemCode;
  readonly message: string;
}

/** What the checks compare a rule with: this video's names and the rules there are. */
export interface AnalystCheckContext {
  readonly topicTitle: string;
  readonly beatIds: readonly string[];
  readonly existingRuleIds: readonly number[];
}

/** Research ids, which belong to one video's notes. */
const RESEARCH_ID = /\b(?:fact|num)-\d+\b/i;

/** Text after a sentence end: a second sentence. */
const SECOND_SENTENCE = /[.!?](?:["”’)\]]*)\s+\S/;

/** Every check on an answer; takes any JSON value (the LLM client runs it before the schema). */
export function analystProblems(value: unknown, ctx: AnalystCheckContext): AnalystProblem[] {
  const parsed = AnalystOutputSchema.safeParse(value);
  if (!parsed.success) return [];
  const { rule, noRule } = parsed.data;
  if (rule && noRule) {
    return [problem('$.noRule', 'rule_and_no_rule', 'Return a rule or noRule, not both.')];
  }
  if (!rule) {
    if (!noRule) {
      return [problem('$.noRule', 'no_rule_reason_missing', 'With no rule, say why in noRule.')];
    }
    const known =
      noRule.duplicateOf === undefined || ctx.existingRuleIds.includes(noRule.duplicateOf);
    return known
      ? []
      : [
          problem(
            '$.noRule.duplicateOf',
            'unknown_rule',
            `There is no rule ${noRule.duplicateOf} under EXISTING RULES.`,
          ),
        ];
  }
  return ruleTextProblems(rule.text, ctx);
}

function ruleTextProblems(text: string, ctx: AnalystCheckContext): AnalystProblem[] {
  const path = '$.rule.text';
  const problems: AnalystProblem[] = [];
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > MAX_RULE_WORDS) {
    problems.push(
      problem(path, 'rule_too_long', `The rule has ${words} words; keep it to ${MAX_RULE_WORDS}.`),
    );
  }
  if (SECOND_SENTENCE.test(text)) {
    problems.push(problem(path, 'rule_multi_sentence', 'Write the rule as one sentence.'));
  }
  const named = videoNames(text, ctx);
  if (named.length > 0) {
    problems.push(
      problem(
        path,
        'rule_names_video',
        `The rule names this video (${named.join(', ')}): say the preference so it fits any topic.`,
      ),
    );
  }
  return problems;
}

/** This video's beat ids, research ids and topic title as the rule writes them. */
function videoNames(text: string, ctx: AnalystCheckContext): string[] {
  const tokens = new Set(text.split(/[^\p{L}\p{N}_-]+/u));
  const beats = ctx.beatIds.filter((id) => tokens.has(id));
  const research = text.match(RESEARCH_ID)?.[0];
  const title =
    ctx.topicTitle.trim() && containsPhrase(text, ctx.topicTitle) ? [`"${ctx.topicTitle}"`] : [];
  return [...beats.map((id) => `beat ${id}`), ...(research ? [research] : []), ...title];
}

const problem = (path: string, code: AnalystProblemCode, message: string): AnalystProblem => ({
  path,
  code,
  message,
});

/** An existing rule this text repeats word for word (case and punctuation aside), if any. */
export function duplicateRule<R extends { readonly id: number; readonly text: string }>(
  text: string,
  rules: readonly R[],
): R | undefined {
  const key = normalizeRuleText(text);
  return rules.find((r) => normalizeRuleText(r.text) === key);
}

/** What a proposal comes to once code has read the answer. */
export type ProposalOutcome =
  | {
      readonly kind: 'rule';
      readonly text: string;
      readonly scope: MemoryRuleScope;
      readonly why: string;
    }
  | {
      readonly kind: 'none';
      readonly reason: NoRuleReason;
      readonly detail: string;
      readonly duplicateOf?: number;
    };

/**
 * The Analyst's answer settled in code: a rule that repeats an existing one word for word
 * (`duplicateRule`) is no rule, reason `duplicate`, whatever the model said.
 */
export function settleProposal(
  output: AnalystOutput,
  existing: readonly { readonly id: number; readonly text: string }[],
): ProposalOutcome {
  const { rule, noRule } = output;
  if (rule) {
    const same = duplicateRule(rule.text, existing);
    if (!same) return { kind: 'rule', text: rule.text, scope: rule.scope, why: rule.why };
    return {
      kind: 'none',
      reason: 'duplicate',
      detail: `Rule ${same.id} already says it: "${same.text}".`,
      duplicateOf: same.id,
    };
  }
  return {
    kind: 'none',
    reason: noRule?.reason ?? 'unclear',
    detail: noRule?.detail ?? 'The Analyst gave no reason.',
    ...(noRule?.duplicateOf !== undefined ? { duplicateOf: noRule.duplicateOf } : {}),
  };
}
