import { describe, expect, it } from 'vitest';
import { validateVideoSpec } from '../spec/validate.ts';
import { partPlan } from './part-plan.ts';
import { DirectorPlanSchema, type DirectorPlan } from './plan.ts';
import { specFromPlan } from './spec.ts';

/** Two parts: part 1 plants a question and ends on a cliffhanger, part 2 recaps and pays off. */
function twoParts(): DirectorPlan {
  return DirectorPlanSchema.parse({
    meta: { title: 'Why queues shed load', topicClass: 'concept', format: 'full' },
    story: {
      devices: ['planted_question', 'cliffhanger_ending', 'recap_opening'],
      chapters: [
        { id: 'burst', title: 'The burst' },
        { id: 'shed', title: 'Shedding' },
      ],
      beats: [
        { id: 'hook', chapterId: 'burst', intent: 'A burst hits', targetSec: 20 },
        { id: 'plant', chapterId: 'burst', intent: 'Who drops first', targetSec: 25 },
        { id: 'recap', chapterId: 'shed', intent: 'Last time', targetSec: 15 },
        { id: 'payoff', chapterId: 'shed', intent: 'The queue drops', targetSec: 30 },
      ],
      plantedQuestion: { text: 'Who drops first?', beatId: 'plant', payoffBeatId: 'payoff' },
      rejectedAlternative: { summary: 'An endless queue', beatId: 'recap' },
      ending: {
        kind: 'spec_card_ending',
        cta: '<example-share-line>',
        specCard: { lines: ['<example-line-1>', '<example-line-2>', '<example-line-3>'] },
      },
    },
    parts: [
      {
        part: 1,
        title: 'The burst',
        mainIdea: 'A burst',
        beatIds: ['hook', 'plant'],
        targetLengthSec: 45,
      },
      {
        part: 2,
        title: 'Shedding',
        mainIdea: 'Shed',
        beatIds: ['recap', 'payoff'],
        targetLengthSec: 45,
      },
    ],
  });
}

describe('partPlan', () => {
  it("keeps a part's beats and chapters, its length, and ends an early part on a cliffhanger", () => {
    const first = partPlan(twoParts(), 1);
    expect(first.parts).toBeUndefined();
    expect(first.meta.targetLengthSec).toBe(45);
    expect(first.story.beats.map((b) => b.id)).toEqual(['hook', 'plant']);
    expect(first.story.chapters.map((c) => c.id)).toEqual(['burst']);
    expect(first.story.ending).toEqual({ kind: 'cliffhanger_ending' });
    // Split across the parts (the Director never does this): dropped, not left dangling.
    expect(first.story.plantedQuestion).toBeUndefined();
    expect(first.story.rejectedAlternative).toBeUndefined();
  });

  it("gives the last part the plan's ending", () => {
    const last = partPlan(twoParts(), 2);
    expect(last.story.beats.map((b) => b.id)).toEqual(['recap', 'payoff']);
    expect(last.story.ending.kind).toBe('spec_card_ending');
    expect(last.story.rejectedAlternative?.beatId).toBe('recap');
    expect(last.story.plantedQuestion).toBeUndefined();
  });

  it('makes specs whose references hold', () => {
    for (const part of [1, 2]) {
      const spec = specFromPlan(partPlan(twoParts(), part), {
        id: 'part',
        series: 'system-design',
      });
      expect(validateVideoSpec(spec).errors).toEqual([]);
    }
  });

  it('keeps a planted question whose two beats are in the part', () => {
    const plan = twoParts();
    plan.story.plantedQuestion = {
      text: 'Who drops first?',
      beatId: 'hook',
      payoffBeatId: 'plant',
    };
    expect(partPlan(plan, 1).story.plantedQuestion?.payoffBeatId).toBe('plant');
  });

  it('refuses a part the plan does not have', () => {
    expect(() => partPlan(twoParts(), 3)).toThrow('no part 3');
  });
});
