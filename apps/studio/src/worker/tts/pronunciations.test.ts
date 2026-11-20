import { DEFAULT_PRONUNCIATIONS, narrationWords } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { planSpeech, pronunciationLookup, respellToken } from './pronunciations.ts';

const lookup = pronunciationLookup(DEFAULT_PRONUNCIATIONS);

describe('respellToken', () => {
  it.each([
    ['Redis', 'reddis'],
    ['Redis,', 'reddis,'],
    ['(UPI)', '(U P I)'],
    ['k8s.', 'kubernetes.'],
    ['K8s', 'kubernetes'],
    ['NGINX', 'engine x'],
    ["Redis's", "reddis's"],
    ['JSON:', 'jay-son:'],
    ['PostgreSQL', 'postgres Q L'],
  ])('%s -> %s', (token, spoken) => {
    expect(respellToken(token, lookup)).toBe(spoken);
  });

  it('matches a key with capitals only in that exact case', () => {
    const us = pronunciationLookup({ US: 'U S' });
    expect(respellToken('US', us)).toBe('U S');
    expect(respellToken('us', us)).toBe('us');
    expect(respellToken('Json', lookup)).toBe('Json');
  });

  it('leaves words inside other words alone', () => {
    expect(respellToken('MySQL', lookup)).toBe('MySQL');
    expect(respellToken('SQLite', lookup)).toBe('SQLite');
  });
});

describe('planSpeech', () => {
  const text = '“Redis” keeps the LRU list — fast.\nThen UPI pays.';
  const plan = planSpeech(text, DEFAULT_PRONUNCIATIONS);

  it('respells words, folds typographic quotes and joins tokens with single spaces', () => {
    expect(plan.spokenText).toBe('"reddis" keeps the L R U list — fast. Then U P I pays.');
  });

  it('has one planned word per narration word, with the original spelling', () => {
    expect(plan.words.map((w) => w.text)).toEqual(narrationWords(text));
  });

  it('points each word at its spoken form', () => {
    const spoken = plan.words.map((w) => plan.spokenText.slice(w.start, w.end));
    expect(spoken).toEqual([
      '"reddis"',
      'keeps',
      'the',
      'L R U',
      'list',
      'fast.',
      'Then',
      'U P I',
      'pays.',
    ]);
  });

  it('keeps original apostrophes in the word text', () => {
    expect(planSpeech('don’t stop', {}).words.map((w) => w.text)).toEqual(['don’t', 'stop']);
  });
});
