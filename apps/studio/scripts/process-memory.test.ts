import { describe, expect, it } from 'vitest';
import { treeRssKb } from './process-memory.ts';

const ps = `
    1     0   1000
  100     1  50000
  101   100 200000
  102   101  30000
  103   100  10000
  200     1  99999
  bad line
`;

describe('treeRssKb', () => {
  it('sums a process and all its descendants, not its siblings', () => {
    expect(treeRssKb(ps, 100)).toBe(50000 + 200000 + 30000 + 10000);
    expect(treeRssKb(ps, 101)).toBe(230000);
  });

  it('is 0 for an unknown pid', () => {
    expect(treeRssKb(ps, 999)).toBe(0);
  });
});
