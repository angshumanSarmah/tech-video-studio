import { describe, expect, it } from 'vitest';
import { DirectorPlanSchema } from '../director/plan.ts';
import { beatsFingerprint, hookKey, mainPatternSequence, planFingerprint } from './fingerprint.ts';

describe('mainPatternSequence', () => {
  it('keeps the first three distinct patterns, in order', () => {
    expect(mainPatternSequence(['a', 'b', 'a', 'c', 'd'])).toBe('a>b>c');
  });

  it('is undefined under two distinct patterns', () => {
    expect(mainPatternSequence(['a', 'a'])).toBeUndefined();
    expect(mainPatternSequence([])).toBeUndefined();
  });
});

describe('hookKey', () => {
  it('reads the first beat after a recap, and defaults the kind to problem', () => {
    const beats = [{ device: 'recap_opening' }, { device: 'cold_open' }, { device: 'x' }];
    expect(hookKey('puzzle', beats)).toBe('puzzle/cold_open');
    expect(hookKey(undefined, beats)).toBe('problem/cold_open');
    expect(hookKey('problem', [{}])).toBeUndefined();
  });
});

describe('planFingerprint', () => {
  const beat = (id: string, device: string, patterns: string[] = []) => ({
    id,
    chapterId: 'c',
    intent: `<example-intent-${id}>`,
    device,
    targetSec: 10,
    suggestedPatternIds: patterns,
  });
  const plan = (parts?: unknown) =>
    DirectorPlanSchema.parse({
      meta: { title: 'T', topicClass: 'concept', format: 'full', targetLengthSec: 40 },
      story: {
        hook: { kind: 'puzzle' },
        chapters: [{ id: 'c', title: 'C' }],
        beats: [
          beat('b1', 'planted_question', ['p1']),
          beat('b2', 'cliffhanger_ending', ['p2']),
          beat('b3', 'recap_opening'),
          beat('b4', 'what_breaks', ['p3', 'p4']),
        ],
        ending: { kind: 'spec_card_ending' },
      },
      ...(parts ? { parts } : {}),
    });

  it('is one fingerprint for a single video', () => {
    expect(planFingerprint(plan())).toEqual([
      { hook: 'puzzle/planted_question', patternSequence: 'p1>p2>p3' },
    ]);
  });

  it('is one per part, each from its own beats', () => {
    const parts = [
      { part: 1, title: 'One', mainIdea: 'i', beatIds: ['b1', 'b2'], targetLengthSec: 45 },
      { part: 2, title: 'Two', mainIdea: 'j', beatIds: ['b3', 'b4'], targetLengthSec: 45 },
    ];
    expect(planFingerprint(plan(parts))).toEqual([
      { hook: 'puzzle/planted_question', patternSequence: 'p1>p2' },
      { hook: 'puzzle/what_breaks', patternSequence: 'p3>p4' },
    ]);
  });

  it('leaves out what a video does not have', () => {
    expect(beatsFingerprint([{ suggestedPatternIds: ['p1'] }], 'problem')).toEqual({});
  });
});
