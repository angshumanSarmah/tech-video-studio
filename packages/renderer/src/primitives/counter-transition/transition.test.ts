import { describe, expect, it } from 'vitest';
import { transitionView } from './transition.ts';

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
