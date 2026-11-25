import { describe, expect, it } from 'vitest';
import { analystProblems, settleProposal, type AnalystCheckContext } from './analyst.ts';

const ctx: AnalystCheckContext = {
  topicTitle: 'Rate limiters',
  beatIds: ['beat1', 'b7'],
  existingRuleIds: [3],
};
const codes = (value: unknown) => analystProblems(value, ctx).map((p) => [p.path, p.code]);
const rule = (text: string) => ({ rule: { text, scope: 'scriptwriter', why: '<example-why>' } });

describe('analystProblems', () => {
  it('passes one short sentence that fits any topic', () => {
    expect(codes(rule('Keep every headline to a few words.'))).toEqual([]);
    expect(
      codes({ rule: null, noRule: { reason: 'one_off', detail: '<example-detail>' } }),
    ).toEqual([]);
  });

  it('flags a long rule, a second sentence and this video’s names', () => {
    expect(codes(rule(Array.from({ length: 21 }, () => 'word').join(' ')))).toEqual([
      ['$.rule.text', 'rule_too_long'],
    ]);
    expect(codes(rule('Keep headlines short. Use plain words.'))).toEqual([
      ['$.rule.text', 'rule_multi_sentence'],
    ]);
    expect(codes(rule('Explain rate limiters with one request.'))).toEqual([
      ['$.rule.text', 'rule_names_video'],
    ]);
    expect(codes(rule('Shorten the headline of b7.'))).toEqual([
      ['$.rule.text', 'rule_names_video'],
    ]);
    expect(codes(rule('Cite fact-2 in the hook.'))).toEqual([['$.rule.text', 'rule_names_video']]);
  });

  it('wants a rule or a reason, not both, and a duplicate of a rule there is', () => {
    expect(codes({ rule: null })).toEqual([['$.noRule', 'no_rule_reason_missing']]);
    expect(
      codes({ ...rule('Keep it short.'), noRule: { reason: 'unclear', detail: 'x' } }),
    ).toEqual([['$.noRule', 'rule_and_no_rule']]);
    expect(
      codes({ rule: null, noRule: { reason: 'duplicate', detail: 'x', duplicateOf: 9 } }),
    ).toEqual([['$.noRule.duplicateOf', 'unknown_rule']]);
  });

  it('accepts anything that is not the shape (the schema reports it)', () => {
    expect(codes('not json')).toEqual([]);
  });
});

describe('settleProposal', () => {
  const existing = [{ id: 3, text: 'Keep every headline to a few words.' }];

  it('turns a word-for-word repeat of an existing rule into a duplicate', () => {
    expect(
      settleProposal(
        { rule: { text: 'keep every headline to a few words', scope: 'scriptwriter', why: 'w' } },
        existing,
      ),
    ).toEqual({
      kind: 'none',
      reason: 'duplicate',
      detail: 'Rule 3 already says it: "Keep every headline to a few words.".',
      duplicateOf: 3,
    });
  });

  it('keeps a new rule, and the model’s reason for none', () => {
    expect(
      settleProposal({ rule: { text: 'Use plain words.', scope: 'all', why: 'w' } }, existing),
    ).toEqual({ kind: 'rule', text: 'Use plain words.', scope: 'all', why: 'w' });
    expect(
      settleProposal({ rule: null, noRule: { reason: 'one_off', detail: 'd' } }, existing),
    ).toEqual({ kind: 'none', reason: 'one_off', detail: 'd' });
  });
});
