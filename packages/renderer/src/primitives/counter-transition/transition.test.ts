import { describe, expect, it } from 'vitest';
import { transitionView } from './transition.ts';
import { CounterTransitionPropsSchema, fromText } from './definition.ts';

describe('transitionView', () => {
  it('shows the change as done without a count event', () => {
    expect(transitionView(undefined)).toMatchObject({ arrow: 1, to: 1, toShift: 0 });
  });

  it('shows only `from`, in full colour, until the count begins', () => {
    expect(transitionView(0)).toEqual({ fromStrength: 1, arrow: 0, to: 0, toShift: 1 });
  });

  it('brings in the arrow and `to` while `from` fades back', () => {
    const done = transitionView(1);
    expect(done).toMatchObject({ arrow: 1, to: 1, toShift: 0 });
    expect(done.fromStrength).toBeLessThan(1);
    expect(done.fromStrength).toBeGreaterThan(0);
  });
});

describe('fromText', () => {
  const base = { to: 9, fromSemantic: 'neutral', toSemantic: 'focus', decimals: 0 } as const;

  it('shows "?" for an unknown from, else the formatted number', () => {
    expect(fromText({ ...base, from: null }, 'en-IN')).toBe('?');
    expect(fromText({ ...base, from: 100000 }, 'en-IN')).toBe('1,00,000');
  });

  it('accepts null in the schema', () => {
    expect(CounterTransitionPropsSchema.parse({ from: null, to: 0.82, decimals: 2 }).from).toBe(
      null,
    );
  });
});
