import { describe, expect, it } from 'vitest';
import { actionProgress, elementState, type ElementEvent } from './element-state.ts';

const FPS = 30;
const at = (action: ElementEvent['action'], frame: number): ElementEvent => ({
  action,
  frame,
  sec: frame / FPS,
});

describe('elementState', () => {
  it('is present from the start when nothing enters it', () => {
    expect(elementState([], 0, FPS)).toEqual({
      presence: 1,
      emphasis: 0,
      dimmed: 0,
      actions: {},
      elapsed: {},
    });
  });

  it('is absent until its enter, ramps in, and ramps out on exit', () => {
    const events = [at('enter', 30), at('exit', 90)];
    expect(elementState(events, 0, FPS).presence).toBe(0);
    expect(elementState(events, 35, FPS).presence).toBeGreaterThan(0);
    expect(elementState(events, 35, FPS).presence).toBeLessThan(1);
    expect(elementState(events, 60, FPS).presence).toBe(1);
    expect(elementState(events, 200, FPS).presence).toBe(0);
  });

  it('holds a highlight until a later dim, and holds a dim until a later highlight or enter', () => {
    const events = [at('highlight', 10), at('dim', 40), at('highlight', 80)];
    expect(elementState(events, 30, FPS)).toMatchObject({ emphasis: 1, dimmed: 0 });
    expect(elementState(events, 70, FPS)).toMatchObject({ emphasis: 0, dimmed: 1 });
    expect(elementState(events, 120, FPS)).toMatchObject({ emphasis: 1, dimmed: 0 });
  });

  it('pulses: emphasis rises and falls back to 0', () => {
    const events = [at('pulse', 0)];
    expect(elementState(events, 0, FPS).emphasis).toBe(0);
    expect(elementState(events, 6, FPS).emphasis).toBeGreaterThan(0.5);
    expect(elementState(events, 18, FPS).emphasis).toBeCloseTo(0);
  });

  it('reports progress of the latest started occurrence: 0 before the first, absent if never', () => {
    const events = [at('count', 30), at('count', 100)];
    expect(elementState(events, 10, FPS).actions).toEqual({ count: 0 });
    expect(elementState(events, 10, FPS).actions.reject).toBeUndefined();
    expect(elementState(events, 90, FPS).actions.count).toBe(1);
    expect(elementState(events, 100, FPS).actions.count).toBe(0);
  });

  it('ignores event order in the input', () => {
    const events = [at('exit', 90), at('enter', 30)];
    expect(elementState(events, 60, FPS).presence).toBe(1);
  });
});

describe('elapsed', () => {
  it('counts seconds since the latest started occurrence: 0 before the first, absent if never', () => {
    const events = [at('count', 30), at('count', 120)];
    expect(elementState(events, 0, FPS).elapsed).toEqual({ count: 0 });
    expect(elementState(events, 90, FPS).elapsed.count).toBeCloseTo(2);
    expect(elementState(events, 150, FPS).elapsed.count).toBeCloseTo(1);
    expect(elementState(events, 150, FPS).elapsed.enter).toBeUndefined();
  });

  it('measures from the unrounded event time, so draft and final rates agree', () => {
    const event = { action: 'enter' as const, sec: 1.01 };
    const final = elementState([{ ...event, frame: 30 }], 60, 30).elapsed.enter;
    const draft = elementState([{ ...event, frame: 15 }], 30, 15).elapsed.enter;
    expect(final).toBeCloseTo(0.99);
    expect(draft).toBe(final);
  });

  it('never goes negative on the frame the event rounds onto', () => {
    expect(elementState([{ action: 'enter', frame: 30, sec: 1.01 }], 30, 30).elapsed.enter).toBe(0);
  });
});

describe('actionProgress', () => {
  it('takes the same time at draft and final frame rates', () => {
    expect(actionProgress(at('enter', 0), 7, 15)).toBeCloseTo(
      actionProgress(at('enter', 0), 14, 30),
      1,
    );
  });
});

describe('counter state end to end', () => {
  it('a counter with a later count event sees count progress 0 from the start', () => {
    const events = [at('enter', 0), at('count', 60)];
    expect(elementState(events, 0, FPS).actions.count).toBe(0);
    expect(elementState(events, 59, FPS).actions.count).toBe(0);
    expect(elementState(events, 90, FPS).actions.count).toBe(1);
  });
});
