import { describe, expect, it } from 'vitest';
import { parseProposalReply, proposedLines, ruleCommands } from './proposals.ts';
import type { MemoryRule } from '#core/services/style-rules.ts';

describe('parseProposalReply', () => {
  it('reads accept, an edit with its text, reject and later (the default)', () => {
    expect(parseProposalReply('a')).toEqual({ kind: 'accept' });
    expect(parseProposalReply('e "Keep headlines short."')).toEqual({
      kind: 'edit',
      text: 'Keep headlines short.',
    });
    expect(parseProposalReply('x')).toEqual({ kind: 'reject' });
    expect(parseProposalReply('')).toEqual({ kind: 'later' });
    expect(parseProposalReply('e').kind).toBe('invalid');
    expect(parseProposalReply('maybe').kind).toBe('invalid');
  });
});

describe('proposal lines', () => {
  const rule = { id: 7, scope: 'generator', text: '<rule>', reason: '<why>' } as MemoryRule;
  it('prints the proposal and how to decide it later', () => {
    expect(proposedLines(rule)).toEqual([
      'Style rule 7 proposed (generator): <rule>',
      '  why: <why>',
    ]);
    expect(ruleCommands(rule)).toEqual([
      '  accept: pnpm studio rules accept 7 [--text "<edited>"] [--scope <scope>]',
      '  reject: pnpm studio rules reject 7',
    ]);
  });
});
