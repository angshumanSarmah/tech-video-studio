import { describe, expect, it } from 'vitest';
import { normalizeNumber, numberSet, quantityTokens } from './numbers.ts';

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
  ])('skips identifiers: %s', (text, expected) => {
    expect(quantityTokens(text)).toEqual(expected);
  });

  it.each([
    ['10,000 requests', ['10,000']],
    ['HTTP 429 Too Many Requests', ['429']],
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
