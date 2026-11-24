import type { CodeIssue, CuratorIssue } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { fixtureGeneratedSpec, recordedNotes } from '../generator/testing.ts';
import { reviewBeatTexts } from './input.ts';
import { passCheck, settleReview } from './review.ts';

const spec = fixtureGeneratedSpec('rate-limiter');
const notes = recordedNotes('rate-limiter');
const check = { beats: reviewBeatTexts(spec, notes), notes };

function issue(change: Partial<CuratorIssue> = {}): CuratorIssue {
  return {
    beatId: 'beat5',
    category: 'visual_contradicts',
    severity: 'blocking',
    owner: 'generator',
    fields: ['board'],
    evidence: [{ kind: 'label', elementId: 'latency', quote: 'round trip per request' }],
    problem: '<example-problem>',
    fix: '<example-fix>',
    ...change,
  };
}

const settle = (issues: CuratorIssue[], codeIssues: CodeIssue[] = []) =>
  settleReview('story', { issues }, { check, level: 'beginner', spec, codeIssues });

describe('settleReview', () => {
  it('keeps verified issues as they are', () => {
    expect(settle([issue()])).toEqual({ issues: [issue()], dropped: [], capped: 0 });
  });

  it('drops an issue whose evidence does not verify, with the reasons', () => {
    const bad = issue({ evidence: [{ kind: 'label', elementId: 'latency', quote: 'slowest' }] });
    const settled = settle([bad, issue()]);
    expect(settled.issues).toEqual([issue()]);
    expect(settled.dropped).toEqual([
      {
        issue: bad,
        why: 'unverified',
        reasons: [expect.objectContaining({ code: 'quote_not_found' })],
      },
    ]);
    expect(settled.dropped[0]?.reasons[0]?.path).toBe('$.issues[0].evidence[0].quote');
  });

  it('drops a retold hook that the code check already found on that beat', () => {
    const retold = issue({
      beatId: 'beat7',
      category: 'hook_retold',
      owner: 'scriptwriter',
      fields: ['narration'],
      evidence: [{ kind: 'narration', quote: 'Checkouts started failing.' }],
    });
    const finding: CodeIssue = {
      path: '$.script[6].narration',
      code: 'hook_number_repeated',
      message: '<example-message>',
      severity: 'blocking',
      owner: 'scriptwriter',
    };
    expect(settle([retold]).issues).toEqual([retold]);
    expect(settle([retold], [finding]).dropped[0]?.why).toBe('repeats_code_finding');
  });

  it('caps a severity above its category and level, and counts it', () => {
    const distracting = issue({ category: 'visual_distracts' });
    const settled = settle([distracting]);
    expect(settled.issues[0]?.severity).toBe('advisory');
    expect(settled.capped).toBe(1);
  });
});

describe('passCheck', () => {
  it('asks for repairs, then lets the last attempt through with soft issues', () => {
    const review = { issues: [issue({ beatId: 'beat9' })] };
    const run = passCheck('story', check);
    expect(run(review, { final: false })).toEqual([
      expect.objectContaining({ code: 'unknown_beat', path: '$.issues[0].beatId' }),
    ]);
    expect(run(review, { final: true }).every((i) => i.soft === true)).toBe(true);
  });
});

describe('settleReview: the pass', () => {
  it('drops an issue reported in the wrong pass', () => {
    const settled = settleReview(
      'claims',
      { issues: [issue()] },
      {
        check,
        level: 'beginner',
        spec,
        codeIssues: [],
      },
    );
    expect(settled.dropped.map((d) => d.reasons.map((r) => r.code))).toEqual([
      ['category_not_in_pass'],
    ]);
  });

  it('counts each coverage repair turn of the claims pass', () => {
    let repairs = 0;
    const run = passCheck('claims', check, () => (repairs += 1));
    run({ claims: [], issues: [] }, { final: false });
    run({ claims: [], issues: [] }, { final: true });
    expect(repairs).toBe(1);
  });
});
