import { describe, expect, it } from 'vitest';
import { counterValue, countValueAt, formatCount, tickProgress } from './format.ts';

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

describe('counterValue', () => {
  const NO_COUNT = undefined;

  it('shows `value` when the counter has no count event', () => {
    expect(counterValue({ value: 10000, decimals: 0 }, NO_COUNT)).toBe(10000);
    expect(counterValue({ value: 10000, from: 50, decimals: 0 }, NO_COUNT)).toBe(10000);
  });

  it('counts up from the default 0: shows 0 until the count begins, then reaches `value`', () => {
    const props = { value: 10000, decimals: 0 };
    expect(counterValue(props, 0)).toBe(0);
    expect(counterValue(props, 0.5)).toBe(5000);
    expect(counterValue(props, 1)).toBe(10000);
  });

  it('counts down when `from` is above `value`', () => {
    const props = { value: 0, from: 10, decimals: 0 };
    expect(counterValue(props, 0)).toBe(10);
    expect(counterValue(props, 0.3)).toBe(7);
    expect(counterValue(props, 1)).toBe(0);
  });
});

describe('tickProgress', () => {
  it('runs linearly over the count run and holds at 1', () => {
    expect(tickProgress(undefined, 4)).toBeUndefined();
    expect(tickProgress(1, 4)).toBe(0.25);
    expect(tickProgress(9, 4)).toBe(1);
  });

  it('finishes at once when the count has no time to run', () => {
    expect(tickProgress(0, 0)).toBe(1);
    expect(tickProgress(0, undefined)).toBe(1);
  });
});
