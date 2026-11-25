import { USAGE_KINDS, type UsageKind, type UsageSummary } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { usageLines } from './usage.ts';

const noCounts = () =>
  Object.fromEntries(USAGE_KINDS.map((k) => [k, []])) as unknown as UsageSummary['counts'];

describe('usageLines', () => {
  it('says how usage gets recorded when nothing is exported yet', () => {
    expect(usageLines({ videos: [], counts: noCounts() })).toEqual([
      'No exported videos yet: usage is recorded when a video’s final is exported.',
    ]);
  });

  it('lists each video’s structure, then the kinds that have values', () => {
    const counts = noCounts();
    counts.hook = [{ value: 'problem/what_breaks', videos: 2 }];
    counts.pattern = [
      { value: 'p1', videos: 2 },
      { value: 'p2', videos: 1 },
    ];
    const video = (id: number, runIds: number[], kind: UsageKind = 'hook') => ({
      videoRunId: id,
      runIds,
      title: `<title-${id}>`,
      exportedAt: '2026-11-25T10:00:00.000Z',
      hooks: kind === 'hook' ? ['problem/what_breaks'] : [],
      endings: ['spec_card_ending'],
      sequences: id === 4 ? ['p1>p2'] : [],
    });
    expect(usageLines({ videos: [video(4, [5, 6]), video(2, [2])], counts })).toEqual([
      'Usage over the last 2 exported video(s), newest first:',
      '  run 4 · 2026-11-25 · "<title-4>" (parts: runs 5, 6)',
      '      hook problem/what_breaks · ending spec_card_ending · patterns p1>p2',
      '  run 2 · 2026-11-25 · "<title-2>"',
      '      hook problem/what_breaks · ending spec_card_ending · patterns -',
      'Videos using each value:',
      '  pattern           p1 2 · p2 1',
      '  hook              problem/what_breaks 2',
    ]);
  });
});
