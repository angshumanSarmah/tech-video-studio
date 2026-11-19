import { describe, expect, it } from 'vitest';
import { elementState, type ElementEvent } from './element-state.ts';
import { revealState } from './reveal.ts';

const FPS = 30;
const at = (action: ElementEvent['action'], frame: number): ElementEvent => ({
  action,
  frame,
  sec: frame / FPS,
  beatEndSec: 100,
});
const reveal = (events: ElementEvent[], frame: number) =>
  revealState(elementState(events, frame, FPS));

describe('revealState', () => {
  it('is fully drawn and opaque without events', () => {
    expect(reveal([], 0)).toEqual({ draw: 1, opacity: 1 });
  });

  it('draws in at full opacity, then fades out on exit', () => {
    const events = [at('enter', 30), at('exit', 90)];
    expect(reveal(events, 0)).toEqual({ draw: 0, opacity: 0 });
    const mid = reveal(events, 36);
    expect(mid.draw).toBeGreaterThan(0);
    expect(mid.draw).toBeLessThan(1);
    expect(mid.opacity).toBeCloseTo(1);
    expect(reveal(events, 95).opacity).toBeLessThan(1);
    expect(reveal(events, 200)).toEqual({ draw: 1, opacity: 0 });
  });

  it('fades when dimmed', () => {
    expect(reveal([at('dim', 0)], 30).opacity).toBeCloseTo(0.3);
  });
});
