import { describe, expect, it } from 'vitest';
import { normalizeNumber, numberSet, numberWordTokens, quantityTokens } from './numbers.ts';

describe('quantityTokens', () => {
  it.each([
    ['IPv4 addresses', []],
    ['an L7 load balancer', []],
    ['p99 latency', []],
    ['a SHA-256 digest', []],
    ['HTTP/2 multiplexing', []],
    ['UTF-8 text', []],
    ['O(log n) lookups', []],
    ['O(1) reads and Θ(n) scans', []],
    ['S3 and x86', []],
    ['HTTP 429 Too Many Requests', []],
    ['a Status 503 page', []],
    ['an error  500 from the store', []],
  ])('skips identifiers: %s', (text, expected) => {
    expect(quantityTokens(text)).toEqual(expected);
  });

  it.each([
    ['10,000 requests', ['10,000']],
    ['returned 429 to every caller', ['429']],
    ['HTTP 1.1, HTTP 2,000 requests, HTTP 600', ['1.1', '2,000', '600']],
    ['an error rate of 503 per hour', ['503']],
    ['sterror 500 (not the word error)', ['500']],
    ['the 2018 outage', ['2018']],
    ['50 ms at the median', ['50']],
    ['50ms, 10k keys, 5xx errors, 2x the limit', ['50', '10', '5', '2']],
    ['up 1.5 times (from 0.4 ms)', ['1.5', '0.4']],
    ['31% failed for 47 minutes', ['31', '47']],
    ['between 5-10 nodes', ['5', '10']],
    ['14 March 2025.', ['14', '2025']],
  ])('keeps standalone quantities: %s', (text, expected) => {
    expect(quantityTokens(text)).toEqual(expected);
  });
});

describe('numberSet', () => {
  it('normalizes grouping commas and keeps identifiers (what a source states)', () => {
    expect(numberSet('1,000 rps over IPv4, then 1,00,000')).toEqual(
      new Set(['1000', '4', '100000']),
    );
  });

  it('matches whole numbers only', () => {
    expect(numberSet('100 tokens').has(normalizeNumber('10'))).toBe(false);
  });
});

describe('numberWordTokens', () => {
  it('finds numbers written as words, as written', () => {
    expect(numberWordTokens('Twenty-four tills, ten coins and a hundred-seat hall.')).toEqual([
      'Twenty-four',
      'ten',
      'hundred-seat',
    ]);
  });

  it('skips "one", vague plurals and words that only contain a number word', () => {
    expect(numberWordTokens('One shared jar; hundreds of beans, often, at a tenth.')).toEqual([]);
  });

  it('allows the everyday "one", "two" and "three" on their own', () => {
    expect(numberWordTokens('One cook, two tills and Three ovens.')).toEqual([]);
  });

  it('still finds larger number words, including ones built on "two" or "three"', () => {
    expect(
      numberWordTokens('Four tills, twenty-two cooks, three-hundred seats, two thousand plates.'),
    ).toEqual(['Four', 'twenty-two', 'three-hundred', 'thousand']);
  });
});
