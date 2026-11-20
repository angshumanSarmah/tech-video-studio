import { describe, expect, it } from 'vitest';
import { numberKey, numberMentions } from './number-mentions.ts';

const values = (text: string) => numberMentions(text).map((m) => m.value);
const texts = (text: string) => numberMentions(text).map((m) => m.text);

describe('numberMentions', () => {
  it.each([
    ['ten thousand requests a second', [10_000]],
    ['forty times the contract', [40]],
    ['twenty-four gateway nodes', [24]],
    ['twenty four nodes', [24]],
    ['three hundred requests', [300]],
    ['one hundred and fifty milliseconds', [150]],
    ['five hundred thousand keys', [500_000]],
    ['two million requests', [2_000_000]],
    ['two thousand one hundred', [2100]],
    ['a thousand requests', [1000]],
    ['a dozen nodes', [12]],
    ['zero point four milliseconds', [0.4]],
    ['two point one milliseconds', [2.1]],
    ['point five percent', [0.5]],
    ['on fourteen March, twenty twenty-five', [14, 2025]],
    ['nineteen ninety-nine', [1999]],
    ['Eighty milliseconds', [80]],
  ])('reads "%s"', (text, expected) => {
    expect(values(text)).toEqual(expected);
  });

  it('reads digits, grouping commas and scale suffixes', () => {
    expect(values('10,000 and 2.1 ms, 10k/s, 2M rows, 2 million, 8 KB, 0.5%, 40x')).toEqual([
      10_000, 2.1, 10_000, 2_000_000, 2_000_000, 8, 0.5, 40,
    ]);
    expect(texts('2 million requests')).toEqual(['2 million']);
  });

  it('splits separate numbers at punctuation and at words that are not numbers', () => {
    expect(values('eighty, then fifty')).toEqual([80, 50]);
    expect(values('ten and twenty')).toEqual([10, 20]);
    expect(values('one hundred. Forty')).toEqual([100, 40]);
  });

  it('marks a lone one, two or three as everyday', () => {
    const mentions = numberMentions('one token, two nodes, one hundred tokens, four nodes');
    expect(mentions.map((m) => [m.text, m.everyday])).toEqual([
      ['one', true],
      ['two', true],
      ['one hundred', false],
      ['four', false],
    ]);
  });

  it('skips identifiers, spoken or in digits', () => {
    expect(values('p99 latency, p ninety-nine latency, IPv4, HTTP 429')).toEqual([]);
    expect(values('HTTP four twenty-nine, status five oh three')).toEqual([]);
    expect(values('a forty times jump')).toEqual([40]);
    expect(values('four twenty-nine responses')).toEqual([429]);
  });

  it('ignores words that only look numeric', () => {
    expect(values('per second, the first node, someone, oneself, tone')).toEqual([]);
  });

  it('keys values so spoken and written forms compare equal', () => {
    expect(numberKey(0.4)).toBe(numberKey(Number('0.4')));
    expect(numberKey(0.1 + 0.2)).toBe(numberKey(0.3));
  });
});
