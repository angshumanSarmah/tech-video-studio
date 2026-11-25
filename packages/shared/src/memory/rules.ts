import { z } from 'zod';
import { MemoryRuleScopeSchema, type MemoryRuleScope } from '../domain/library.ts';

/**
 * Style rules (P1C.10): the reviewer's standing preferences, proposed by the Analyst from a gate
 * note and applied only once accepted. Each reaches the agents of its scope; `all` means the
 * three writers (the Curator reviews, so a writer's preference is never its own). Code checks
 * never read rules.
 */

/** Active rules that may reach any one agent (its own scope plus `all` for a writer). */
export const MAX_RULES_PER_AGENT = 12;

/** Characters in one rule: one line. */
export const MAX_RULE_CHARS = 160;

/** Words in one rule, as the Analyst prompt asks ("at most 20 words"). */
export const MAX_RULE_WORDS = 20;

/** The agents rules reach, and the writers `all` stands for. */
export const RULE_AGENTS = ['director', 'scriptwriter', 'generator', 'curator'] as const;
export type RuleAgent = (typeof RULE_AGENTS)[number];
export const WRITER_AGENTS = ['director', 'scriptwriter', 'generator'] as const;

const WRITERS: readonly RuleAgent[] = WRITER_AGENTS;

/** The agents a rule of this scope reaches. */
export function agentsReached(scope: MemoryRuleScope): RuleAgent[] {
  return scope === 'all' ? [...WRITER_AGENTS] : [scope];
}

/** The scopes whose rules reach this agent: its own, and `all` for a writer. */
export function scopesReaching(agent: RuleAgent): MemoryRuleScope[] {
  return WRITERS.includes(agent) ? [agent, 'all'] : [agent];
}

/** A rule's text: one trimmed line of at most `MAX_RULE_CHARS` characters. */
export const RuleTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_RULE_CHARS)
  .refine((text) => !/[\r\n]/.test(text), 'A rule is one line.');

/** What each scope controls, as the Analyst reads it (the closed list of scopes). */
export const MEMORY_RULE_SCOPE_TEXT: Readonly<Record<MemoryRuleScope, string>> = {
  director:
    'the plan: the hook, the beats and their order, devices, suggested patterns, layout modes, length, parts and the ending.',
  scriptwriter: 'the words: narration, headlines, tags, stat cards and source lines.',
  generator:
    'the boards: which elements and patterns show an idea, board labels, motion and focus.',
  curator: 'the review: what the reviewer flags and how severe it calls it.',
  all: 'a preference all three writers (director, scriptwriter, generator) follow.',
};

/** The Analyst's closed list of scopes, from `MEMORY_RULE_SCOPE_TEXT`. */
export function ruleScopesSection(): string {
  return [
    '## RULE SCOPES (exhaustive: use only these scopes; there are no others)',
    ...MemoryRuleScopeSchema.options.map((scope) => `- ${scope}: ${MEMORY_RULE_SCOPE_TEXT[scope]}`),
  ].join('\n');
}

/** A rule's text compared for duplicates: lowercase, letters and digits only, single spaces. */
export function normalizeRuleText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
