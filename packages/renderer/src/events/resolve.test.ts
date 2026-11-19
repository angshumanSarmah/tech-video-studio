import { describe, expect, it } from 'vitest';
import {
  ACTION_DURATION_SEC,
  HIGHLIGHT_LEAD_SEC,
  SCAN_MAX_SEC,
  SCAN_STEP_SEC,
  STAGGER_MAX_SEC,
  STAGGER_STEP_SEC,
} from './presets.ts';
import {
  resolveElementEvents,
  staggerStep,
  type AnchoredEvent,
  type ResolveContext,
} from './resolve.ts';

const beat = { beatStartSec: 10, beatEndSec: 20 };
const ev = (
  action: AnchoredEvent['action'],
  sec: number,
  targets: string[],
  params?: Record<string, unknown>,
): AnchoredEvent => ({ action, sec, targets, ...(params ? { params } : {}), ...beat });

/** Keys: plain ids map to themselves; `group` is a pattern instance of g/a, g/b, g/c. */
const ctx = (overrides: Partial<ResolveContext> = {}): ResolveContext => ({
  fps: 30,
  keysFor: (t) => (t === 'group' ? ['group/a', 'group/b', 'group/c'] : [t]),
  partOrder: (key) => (key === 'grid' ? ['p1', 'p2', 'p3', 'p4', 'p5'] : []),
  focusChanges: [],
  ...overrides,
});

const secs = (map: Map<string, { sec: number }[]>, key: string) =>
  (map.get(key) ?? []).map((e) => e.sec);

describe('staggerStep', () => {
  it('spreads a default group by a small step, capped in total', () => {
    expect(staggerStep(1, 'default', 0)).toBe(0);
    expect(staggerStep(3, 'default', 0)).toBe(STAGGER_STEP_SEC);
    expect(staggerStep(21, 'default', 0)).toBeCloseTo(STAGGER_MAX_SEC / 20);
  });

  it('spreads a scan by its step, capped by the room it has', () => {
    expect(staggerStep(4, 'scan', SCAN_MAX_SEC)).toBe(SCAN_STEP_SEC);
    expect(staggerStep(11, 'scan', 1)).toBeCloseTo(0.1);
    expect(staggerStep(3, 'scan', -1)).toBe(0);
  });
});

describe('resolveElementEvents', () => {
  it('keeps a single-target event on its anchor, with its frame at the fps', () => {
    const out = resolveElementEvents([ev('enter', 12.34, ['api'])], ctx({ fps: 15 }));
    expect(out.get('api')).toEqual([{ action: 'enter', sec: 12.34, frame: 185, beatEndSec: 20 }]);
  });

  it('staggers an event on several targets in target order', () => {
    const out = resolveElementEvents([ev('enter', 12, ['b', 'a'])], ctx());
    expect(secs(out, 'b')).toEqual([12]);
    expect(secs(out, 'a')).toEqual([12 + STAGGER_STEP_SEC]);
  });

  it('staggers the elements of a pattern instance, and not actions timed to a word', () => {
    const out = resolveElementEvents(
      [ev('exit', 12, ['group']), ev('reject', 13, ['group'])],
      ctx(),
    );
    expect(secs(out, 'group/c')[0]).toBeCloseTo(12 + 2 * STAGGER_STEP_SEC);
    expect(secs(out, 'group/c')[1]).toBe(13);
  });

  it('splits an event on several parts into one event per part, staggered in list order', () => {
    const out = resolveElementEvents([ev('pulse', 12, ['grid'], { parts: ['p3', 'p1'] })], ctx());
    expect(out.get('grid')?.map((e) => [e.params?.parts, e.sec])).toEqual([
      [['p3'], 12],
      [['p1'], 12 + STAGGER_STEP_SEC],
    ]);
  });

  it('sweeps a scan through parts in the element’s own order, sharing one sweep', () => {
    const out = resolveElementEvents(
      [
        ev('reject', 12, ['grid'], { parts: ['p5', 'p1', 'p2'], stagger: 'scan' }),
        ev('pulse', 12, ['grid'], { parts: ['p3'], stagger: 'scan' }),
      ],
      ctx(),
    );
    const at = (part: string) =>
      out.get('grid')?.find((e) => (e.params?.parts as string[])[0] === part)?.sec;
    expect(at('p1')).toBe(12);
    expect(at('p2')).toBeCloseTo(12 + SCAN_STEP_SEC);
    expect(at('p3')).toBeCloseTo(12 + 2 * SCAN_STEP_SEC);
    expect(at('p5')).toBeCloseTo(12 + 4 * SCAN_STEP_SEC);
  });

  it('caps a scan by the beat’s next event and by its maximum', () => {
    const next = [
      ev('reject', 12, ['grid'], { parts: ['p1', 'p5'], stagger: 'scan' }),
      ev('enter', 12.4, ['other']),
    ];
    const capped = resolveElementEvents(next, ctx()).get('grid')?.at(-1)?.sec;
    expect(capped).toBeCloseTo(12.4);
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const long = resolveElementEvents([ev('enter', 12, many, { stagger: 'scan' })], ctx());
    expect(secs(long, 't29')[0]).toBeCloseTo(12 + SCAN_MAX_SEC);
  });

  it('starts a highlight before its word, never before its beat', () => {
    const out = resolveElementEvents(
      [ev('highlight', 12, ['a']), ev('highlight', 10.05, ['b'])],
      ctx(),
    );
    expect(secs(out, 'a')).toEqual([12 - HIGHLIGHT_LEAD_SEC]);
    expect(secs(out, 'b')).toEqual([10]);
  });

  it('clears a highlight by the end of its beat, or by the next focus change', () => {
    const duration = ACTION_DURATION_SEC.highlight;
    const byBeat = resolveElementEvents([ev('highlight', 12, ['a'])], ctx());
    expect(byBeat.get('a')?.[0]?.untilSec).toBeCloseTo(20 - duration);
    const byFocus = resolveElementEvents(
      [ev('highlight', 12, ['a'])],
      ctx({ focusChanges: [11, 12, 15] }),
    );
    expect(byFocus.get('a')?.[0]?.untilSec).toBeCloseTo(15 - duration);
  });

  it('lets a highlight come fully on before it clears, and holds one that asks to', () => {
    const late = resolveElementEvents([ev('highlight', 19.9, ['a'])], ctx());
    const start = 19.9 - HIGHLIGHT_LEAD_SEC;
    expect(late.get('a')?.[0]?.untilSec).toBeCloseTo(start + ACTION_DURATION_SEC.highlight);
    const held = resolveElementEvents([ev('highlight', 12, ['a'], { hold: true })], ctx());
    expect(held.get('a')?.[0]).not.toHaveProperty('untilSec');
  });

  it('leaves focus events to the focus track', () => {
    expect(resolveElementEvents([ev('focus', 12, ['a'])], ctx()).size).toBe(0);
  });
});
