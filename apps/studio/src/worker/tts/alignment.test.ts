import { DEFAULT_PRONUNCIATIONS } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { alignWords, placeTokens, type EngineToken } from './alignment.ts';
import { planSpeech } from './pronunciations.ts';

const tok = (text: string, startSec: number | null, endSec: number | null, phonemes = 'x') => ({
  text,
  phonemes,
  startSec,
  endSec,
});

describe('alignWords', () => {
  it('maps tokens back to words, spanning respelled words over all their tokens', () => {
    const plan = planSpeech('The UPI call, $10.', DEFAULT_PRONUNCIATIONS);
    const tokens: EngineToken[] = [
      tok('The', 0.2, 0.3),
      tok('U', 0.3, 0.5),
      tok('P', 0.5, 0.7),
      tok('I', 0.7, 0.9),
      tok('call', 0.9, 1.2),
      tok(',', 1.2, 1.3, ','),
      tok('$', null, null, ''),
      tok('10', 1.3, 1.9),
      tok('.', 1.9, 2.1, '.'),
    ];
    expect(alignWords(plan, tokens)).toEqual({
      ok: true,
      words: [
        { text: 'the', startSec: 0.2, endSec: 0.3 },
        { text: 'upi', startSec: 0.3, endSec: 0.9 },
        { text: 'call', startSec: 0.9, endSec: 1.2 },
        { text: '10', startSec: 1.3, endSec: 1.9 },
      ],
    });
  });

  it('spans a word split into several tokens (contractions, hyphens)', () => {
    const plan = planSpeech("can't rate-limit", {});
    const tokens = [tok('ca', 0, 0.2), tok("n't", 0.2, 0.4), tok('rate-limit', 0.4, 1)];
    const result = alignWords(plan, tokens);
    expect(result.ok && result.words.map((w) => [w.startSec, w.endSec])).toEqual([
      [0, 0.4],
      [0.4, 1],
    ]);
  });

  it('never lets a pause after a word stretch the word', () => {
    const plan = planSpeech('dry. No', {});
    const result = alignWords(plan, [
      tok('dry', 0, 0.5),
      tok('.', 0.5, 0.8, '.'),
      tok('No', 0.8, 1),
    ]);
    expect(result.ok && result.words[0]).toEqual({ text: 'dry', startSec: 0, endSec: 0.5 });
  });

  it('fails a word with no spoken token instead of interpolating it', () => {
    const plan = planSpeech('the Zorblax limit', {});
    const result = alignWords(plan, [
      tok('the', 0, 0.2),
      tok('Zorblax', null, null, ''),
      tok('limit', 0.2, 0.6),
    ]);
    expect(result).toEqual({
      ok: false,
      problems: ['word not spoken: zorblax (word 1, read as "Zorblax")'],
    });
  });

  it('fails a word whose token the engine changed beyond recognition', () => {
    const plan = planSpeech('one two', {});
    const result = alignWords(plan, [tok('one', 0, 0.2), tok('2', 0.2, 0.4)]);
    expect(result.ok).toBe(false);
  });

  it('applies chunk offsets as given (times are already global)', () => {
    const plan = planSpeech('a\nb', {});
    const result = alignWords(plan, [tok('a', 0.1, 0.3), tok('b', 2.4, 2.6)]);
    expect(result.ok && result.words.map((w) => w.startSec)).toEqual([0.1, 2.4]);
  });
});

describe('placeTokens', () => {
  it('does not jump over unread words to place a token further on', () => {
    const placed = placeTokens('alpha beta a', [tok('a', 0, 0.1)]);
    expect(placed).toEqual([{ start: 0, end: 1, startSec: 0, endSec: 0.1 }]);
    expect(placeTokens('beta a', [tok('a', 0, 0.1)])).toEqual([]);
  });
});
