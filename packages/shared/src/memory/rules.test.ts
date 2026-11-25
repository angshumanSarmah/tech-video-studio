import { describe, expect, it } from 'vitest';
import { MEMORY_RULE_SCOPES } from '../domain/library.ts';
import {
  agentsReached,
  normalizeRuleText,
  RULE_AGENTS,
  RuleTextSchema,
  ruleScopesSection,
  scopesReaching,
} from './rules.ts';

describe('rule scopes', () => {
  it('"all" reaches the three writers, never the Curator', () => {
    expect(agentsReached('all')).toEqual(['director', 'scriptwriter', 'generator']);
    expect(agentsReached('curator')).toEqual(['curator']);
    expect(scopesReaching('generator')).toEqual(['generator', 'all']);
    expect(scopesReaching('curator')).toEqual(['curator']);
  });

  it('is consistent both ways for every agent and scope', () => {
    for (const scope of MEMORY_RULE_SCOPES) {
      for (const agent of RULE_AGENTS) {
        expect(agentsReached(scope).includes(agent)).toBe(scopesReaching(agent).includes(scope));
      }
    }
  });

  it('lists every scope in the Analyst’s closed list', () => {
    const section = ruleScopesSection();
    for (const scope of MEMORY_RULE_SCOPES) expect(section).toContain(`\n- ${scope}: `);
  });
});

describe('RuleTextSchema', () => {
  it('takes one trimmed line of at most 160 characters', () => {
    expect(RuleTextSchema.parse('  Keep each board label short.  ')).toBe(
      'Keep each board label short.',
    );
    expect(RuleTextSchema.safeParse('one\ntwo').success).toBe(false);
    expect(RuleTextSchema.safeParse('x'.repeat(161)).success).toBe(false);
    expect(RuleTextSchema.safeParse('   ').success).toBe(false);
  });
});

describe('normalizeRuleText', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normalizeRuleText('Keep headlines short!')).toBe(
      normalizeRuleText('keep  headlines, short'),
    );
  });
});
