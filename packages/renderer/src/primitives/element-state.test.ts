import { describe, expect, it } from 'vitest';
import {
  actionProgress,
  actionRunSec,
  elementState,
  IDLE_STATE,
  partState,
  type ElementEvent,
} from './element-state.ts';

const FPS = 30;
const at = (action: ElementEvent['action'], frame: number, beatEndSec = 100): ElementEvent => ({
  action,
  frame,
  sec: frame / FPS,
  beatEndSec,
});

describe('elementState', () => {
  it('is present from the start when nothing enters it', () => {
    expect(elementState([], 0, FPS)).toEqual({
      presence: 1,
      emphasis: 0,
      highlight: 0,
      dimmed: 0,
      actions: {},
      elapsed: {},
      runSec: {},
      parts: {},
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

  it('re-enters after an exit: absent, in, out, and in again', () => {
    const events = [at('enter', 30), at('exit', 90), at('enter', 150)];
    expect(elementState(events, 0, FPS).presence).toBe(0);
    expect(elementState(events, 80, FPS).presence).toBe(1);
    expect(elementState(events, 140, FPS).presence).toBe(0);
    const reentering = elementState(events, 155, FPS).presence;
    expect(reentering).toBeGreaterThan(0);
    expect(reentering).toBeLessThan(1);
    expect(elementState(events, 200, FPS).presence).toBe(1);
  });

  it('starts present when its first presence event is an exit, and can re-enter', () => {
    const events = [at('enter', 120), at('exit', 30)];
    expect(elementState(events, 0, FPS).presence).toBe(1);
    expect(elementState(events, 100, FPS).presence).toBe(0);
    expect(elementState(events, 200, FPS).presence).toBe(1);
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

  it('ends a held highlight at a reject (highlight → reject)', () => {
    const events = [at('highlight', 0), at('lock', 20), at('reject', 40)];
    expect(elementState(events, 30, FPS)).toMatchObject({ highlight: 1, emphasis: 1 });
    const after = elementState(events, 80, FPS);
    expect(after).toMatchObject({ highlight: 0, emphasis: 0 });
    // Lock is state, not emphasis: it stays.
    expect(after.actions).toMatchObject({ lock: 1, reject: 1 });
  });

  it('holds a highlight that comes after the reject (highlight → reject → highlight)', () => {
    const events = [at('highlight', 0), at('reject', 40), at('highlight', 80)];
    expect(elementState(events, 60, FPS)).toMatchObject({ highlight: 0 });
    expect(elementState(events, 120, FPS)).toMatchObject({ highlight: 1, emphasis: 1 });
  });

  it('reports the held highlight apart from the pulse bump', () => {
    const events = [at('pulse', 0), at('highlight', 30)];
    expect(elementState(events, 6, FPS)).toMatchObject({ highlight: 0 });
    expect(elementState(events, 6, FPS).emphasis).toBeGreaterThan(0.5);
    expect(elementState(events, 60, FPS)).toMatchObject({ emphasis: 1, highlight: 1 });
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
    const event = { action: 'enter' as const, sec: 1.01, beatEndSec: 5 };
    const final = elementState([{ ...event, frame: 30 }], 60, 30).elapsed.enter;
    const draft = elementState([{ ...event, frame: 15 }], 30, 15).elapsed.enter;
    expect(final).toBeCloseTo(0.99);
    expect(draft).toBe(final);
  });

  it('never goes negative on the frame the event rounds onto', () => {
    const event = { action: 'enter' as const, frame: 30, sec: 1.01, beatEndSec: 5 };
    expect(elementState([event], 30, 30).elapsed.enter).toBe(0);
  });
});

describe('runSec', () => {
  it('runs until the next reject after it, even past an exit or the beat end', () => {
    const events = [at('count', 30, 3), at('exit', 60), at('reject', 150)];
    expect(actionRunSec(events[0] as ElementEvent, events)).toBeCloseTo(4);
  });

  it('without a reject, runs until the exit when it comes before the beat end', () => {
    const events = [at('count', 30, 5), at('exit', 90)];
    expect(actionRunSec(events[0] as ElementEvent, events)).toBeCloseTo(2);
  });

  it('without a reject or an earlier exit, runs until the end of its beat', () => {
    const events = [at('count', 30, 2.5), at('exit', 120)];
    expect(actionRunSec(events[0] as ElementEvent, events)).toBeCloseTo(1.5);
  });

  it('ignores a reject before the occurrence', () => {
    const events = [at('reject', 0), at('count', 30, 2)];
    expect(actionRunSec(events[1] as ElementEvent, events)).toBeCloseTo(1);
  });

  it('reports the first occurrence before any starts, then the latest started one', () => {
    const events = [at('count', 30, 10), at('count', 120, 10), at('reject', 180)];
    expect(elementState(events, 0, FPS).runSec.count).toBeCloseTo(5);
    expect(elementState(events, 150, FPS).runSec.count).toBeCloseTo(2);
    expect(elementState(events, 0, FPS).runSec.enter).toBeUndefined();
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

describe('parts', () => {
  const forParts = (event: ElementEvent, ...parts: string[]): ElementEvent => ({
    ...event,
    params: { parts },
  });

  it('routes events that name parts to those parts only', () => {
    const events = [at('enter', 0), forParts(at('lock', 30), 'h3', 'h4'), at('highlight', 60)];
    const state = elementState(events, 90, FPS);
    expect(state.actions.lock).toBeUndefined();
    expect(state.emphasis).toBe(1);
    expect(Object.keys(state.parts)).toEqual(['h3', 'h4']);
    expect(partState(state, 'h3').actions.lock).toBe(1);
    expect(partState(state, 'h3').emphasis).toBe(0);
  });

  it('applies the element rules within a part (presence, held highlight, run time)', () => {
    const events = [
      forParts(at('enter', 30), 'item'),
      forParts(at('highlight', 40), 'item'),
      forParts(at('exit', 90), 'item'),
    ];
    expect(partState(elementState(events, 0, FPS), 'item').presence).toBe(0);
    expect(partState(elementState(events, 80, FPS), 'item')).toMatchObject({
      presence: 1,
      emphasis: 1,
    });
    expect(partState(elementState(events, 200, FPS), 'item').presence).toBe(0);
    expect(partState(elementState(events, 0, FPS), 'item').runSec.enter).toBeCloseTo(2);
  });

  it('reads an unnamed part as idle', () => {
    const state = elementState([at('dim', 0)], 30, FPS);
    expect(partState(state, 'seat-1')).toEqual(IDLE_STATE);
    expect(partState(state, 'toString')).toEqual(IDLE_STATE);
  });

  it("ends a part's highlight at that part's reject, keeping its lock and other parts", () => {
    const events = [
      forParts(at('highlight', 0), 'b2', 'b3'),
      forParts(at('lock', 10), 'b2'),
      forParts(at('reject', 40), 'b2'),
      forParts(at('highlight', 100), 'b2'),
    ];
    const rejected = elementState(events, 80, FPS);
    expect(partState(rejected, 'b2')).toMatchObject({ highlight: 0, emphasis: 0 });
    expect(partState(rejected, 'b2').actions.lock).toBe(1);
    expect(partState(rejected, 'b3')).toMatchObject({ highlight: 1 });
    expect(partState(elementState(events, 140, FPS), 'b2')).toMatchObject({ highlight: 1 });
  });

  it('treats malformed parts params as a whole-element event', () => {
    const event = { ...at('highlight', 0), params: { parts: 'h3' } };
    const state = elementState([event], 30, FPS);
    expect(state.emphasis).toBe(1);
    expect(state.parts).toEqual({});
  });
});
