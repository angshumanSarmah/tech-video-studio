import type { Claim, CodeIssue, CuratorIssue } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { fixtureGeneratedSpec, recordedNotes } from '../generator/testing.ts';
import { reviewBeatTexts, roundBeatIds, roundCoverage, type CuratorRound } from './input.ts';
import { mergeClaims, passCheck, settleReview } from './review.ts';
import { boardOnlyChange } from '../../jobs/curate.ts';

const spec = fixtureGeneratedSpec('rate-limiter');
const notes = recordedNotes('rate-limiter');
const check = { beats: reviewBeatTexts(spec), notes };

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

describe('scoped rounds', () => {
  const c = (beatId: string, source: Claim['source'], text: string): Claim => ({
    beatId,
    source,
    text,
    verdict: 'no_claim',
    ids: [],
  });
  const previousClaims = [
    c('beat1', 'narration', 'old 1'),
    c('beat2', 'narration', 'old 2'),
    c('beat2', 'value', '100'),
    c('beat3', 'narration', 'old 3'),
  ];
  const round = (changed: string[], boardOnly = false): CuratorRound => ({
    previous: [],
    changedBeatIds: changed,
    previousClaims,
    boardOnly,
  });

  it("shows the changed beats and a planted question's partner", () => {
    expect(roundBeatIds(spec, ['beat2'])).toEqual(['beat2']);
    expect(roundBeatIds(spec, ['beat7'])).toEqual(['beat5', 'beat7']);
    expect(roundBeatIds(spec, ['beat5', 'beat8'])).toEqual(['beat5', 'beat7', 'beat8']);
  });

  it('covers the changed beats, without sentences when board-only; nothing outside a carried round', () => {
    expect(roundCoverage(round(['beat2']))).toEqual({ beatIds: ['beat2'], narration: true });
    expect(roundCoverage(round(['beat2'], true))).toEqual({ beatIds: ['beat2'], narration: false });
    expect(roundCoverage({ previous: [], changedBeatIds: ['beat2'] })).toBeUndefined();
  });

  it("merges the round's claims over the carried audit, in beat order", () => {
    const answered = [
      c('beat2', 'narration', 'new 2'),
      c('beat2', 'value', '99'),
      c('beat3', 'narration', 'stray'),
    ];
    expect(mergeClaims(spec, round(['beat2']), answered).map((x) => x.text)).toEqual([
      'old 1',
      'new 2',
      '99',
      'old 3',
    ]);
    // Board-only: the narration audit carries, only the values are new.
    expect(mergeClaims(spec, round(['beat2'], true), answered).map((x) => x.text)).toEqual([
      'old 1',
      'old 2',
      '99',
      'old 3',
    ]);
    expect(mergeClaims(spec, undefined, answered)).toEqual(answered);
  });

  it('a round is board-only when every changed beat kept its script', () => {
    const boardEdit = structuredClone(spec);
    boardEdit.scenes[1]!.transitionIn = 'cut';
    expect(boardOnlyChange(spec, boardEdit, new Set(['beat2']))).toBe(true);
    const scriptEdit = structuredClone(spec);
    scriptEdit.script[1]!.narration += ' More.';
    expect(boardOnlyChange(spec, scriptEdit, new Set(['beat2']))).toBe(false);
    expect(boardOnlyChange(spec, spec, new Set())).toBe(false);
  });
});
