import { describe, expect, it } from 'vitest';
import { countValueAt, formatCount } from './format.ts';

describe('formatCount', () => {
  it('groups in lakhs and crores for en-IN', () => {
    expect(formatCount(100000, 'en-IN')).toBe('1,00,000');
    expect(formatCount(12345678, 'en-IN')).toBe('1,23,45,678');
  });

  it('groups in thousands for en-US', () => {
    expect(formatCount(100000, 'en-US')).toBe('100,000');
    expect(formatCount(12345678, 'en-US')).toBe('12,345,678');
  });

  it('shows a fixed number of decimals', () => {
    expect(formatCount(19.4, 'en-IN', 1)).toBe('19.4');
    expect(formatCount(2, 'en-US', 2)).toBe('2.00');
  });
});

describe('countValueAt', () => {
  it('interpolates and rounds to the requested decimals', () => {
    expect(countValueAt(0, 10, 0.55)).toBe(6);
    expect(countValueAt(10, 0, 1)).toBe(0);
    expect(countValueAt(0, 1, 0.333, 2)).toBe(0.33);
  });
});
