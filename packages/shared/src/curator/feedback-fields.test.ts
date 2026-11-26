import { describe, expect, it } from 'vitest';
import { feedbackAbout, fieldsForFeedback } from './feedback-fields.ts';

// Reviewer notes in the shape of the first real run's gate fixes (paraphrased, invented values).
describe('feedbackAbout', () => {
  it('a note about what is drawn is about the board', () => {
    for (const note of [
      'Make fast vs slow the whole board: a cache card near the request and a store card far off, both big enough to read.',
      'The headline stat card is the hook: give it the focus on its number so it is not greyed out.',
      'Show one job as visibly slow, e.g. a long bar or a timer, while the jobs behind it wait in the queue.',
    ]) {
      expect(feedbackAbout(note)).toBe('board');
    }
  });

  it('a note about what is said is about the narration', () => {
    for (const note of [
      "Don't say every worker locks the table; the notes don't say that. If you mention more nodes, add that the data is split.",
      "Say 'when requests are batched' instead of the term; a later beat introduces it.",
      'Do not call it strictly lock-free; keep it a question.',
    ]) {
      expect(feedbackAbout(note)).toBe('narration');
    }
  });

  it('quoted text is a label, not a cue', () => {
    expect(feedbackAbout("Pin 'say less' to the store card, not the cache.")).toBe('board');
    expect(feedbackAbout('Say "the card is declined" instead.')).toBe('narration');
  });

  it('both kinds of cue, or neither, is both', () => {
    expect(feedbackAbout('Say it more simply and make the icons bigger.')).toBe('both');
    expect(feedbackAbout('shorter')).toBe('both');
  });
});

describe('fieldsForFeedback', () => {
  it('gives the regenerate fields for the note', () => {
    expect(fieldsForFeedback('Pin the tag to the other card.')).toEqual(['board']);
    expect(fieldsForFeedback("Don't say it twice.")).toEqual(['narration']);
    expect(fieldsForFeedback('better')).toEqual(['narration', 'board']);
  });
});
