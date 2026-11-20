import { describe, expect, it } from 'vitest';
import type { ElementEvent } from '../primitives/element-state.ts';
import {
  focusChanges,
  focusChangeSecs,
  focusKeys,
  focusLevel,
  focusTrack,
  inFocus,
  overlayToggles,
  type FocusTrackInput,
} from './focus.ts';
import { ACTION_DURATION_SEC } from './presets.ts';
import type { AnchoredEvent } from './resolve.ts';

const beat = { beatStartSec: 0, beatEndSec: 10, sceneEndSec: 10 };
const anchored = (action: AnchoredEvent['action'], sec: number, targets: string[]) => ({
  action,
  sec,
  targets,
  ...beat,
});
const element = (action: ElementEvent['action'], sec: number): ElementEvent => ({
  action,
  sec,
  frame: Math.round(sec * 30),
  beatEndSec: 10,
});
const noHosts = () => undefined;

describe('inFocus', () => {
  it('focuses everything under an empty set', () => {
    expect(inFocus('api', [], noHosts)).toBe(true);
  });

  it('matches the id, the elements of a focused instance, and followers of a focused host', () => {
    const hosts = new Map([
      ['tag', 'api'],
      ['badge', 'tag'],
    ]);
    const hostOf = (k: string) => hosts.get(k);
    expect(inFocus('api', ['api'], hostOf)).toBe(true);
    expect(inFocus('flood/server', ['flood'], hostOf)).toBe(true);
    expect(inFocus('flooding', ['flood'], hostOf)).toBe(false);
    expect(inFocus('badge', ['api'], hostOf)).toBe(true);
    expect(inFocus('client', ['api'], hostOf)).toBe(false);
  });

  it('survives a cycle of hosts', () => {
    const hostOf = (k: string) => (k === 'a' ? 'b' : 'a');
    expect(inFocus('a', ['c'], hostOf)).toBe(false);
  });
});

describe('focusChanges', () => {
  it('lists each beat’s focus (the first settled), then focus events, in time order', () => {
    const beats = [
      { focus: ['api'], startSec: 0 },
      { focus: [], startSec: 5 },
    ];
    const events = [anchored('focus', 3, ['db']), anchored('enter', 1, ['x'])];
    expect(focusChanges(beats, events)).toEqual([
      { sec: 0, ids: ['api'], animate: false },
      { sec: 3, ids: ['db'], animate: true },
      { sec: 5, ids: [], animate: true },
    ]);
  });

  it('counts focus events and whole overlay entrances and exits as focus changes', () => {
    const isOverlay = (t: string) => t === 'card';
    const events = [
      anchored('focus', 1, ['a']),
      anchored('enter', 2, ['card']),
      anchored('pulse', 3, ['card']),
      anchored('exit', 4, ['card']),
      anchored('enter', 5, ['a']),
    ];
    expect(focusChangeSecs(events, isOverlay)).toEqual([1, 2, 4]);
  });
});

describe('overlayToggles', () => {
  it('is on from the beat that adds it unless it enters, then follows its enters and exits', () => {
    expect(overlayToggles([], 4)).toEqual([{ sec: 4, on: true, durationSec: 0, action: 'enter' }]);
    const toggles = overlayToggles([element('enter', 2), element('exit', 6)], 0);
    expect(toggles.map((t) => [t.sec, t.on])).toEqual([
      [2, true],
      [6, false],
    ]);
    expect(toggles[1]?.durationSec).toBe(ACTION_DURATION_SEC.exit);
  });
});

describe('focusKeys and focusLevel', () => {
  const track = (overrides: Partial<FocusTrackInput> = {}): FocusTrackInput => ({
    changes: [
      { sec: 0, ids: ['api'], animate: false },
      { sec: 4, ids: ['db'], animate: true },
      { sec: 8, ids: [], animate: true },
    ],
    overlays: [],
    hostOf: noHosts,
    ...overrides,
  });

  it('starts settled, then animates each change of its own dim', () => {
    const keys = focusKeys('db', track());
    expect(keys.map((k) => [k.sec, k.dim, k.durationSec])).toEqual([
      [0, 1, 0],
      [4, 0, ACTION_DURATION_SEC.focus],
    ]);
    expect(focusLevel(keys, 0)).toBe(1);
    expect(focusLevel(keys, 4 + ACTION_DURATION_SEC.focus / 2)).toBeCloseTo(0.5);
    expect(focusLevel(keys, 5)).toBe(0);
  });

  it('dims everything but the focus, and nothing under an empty set', () => {
    const keys = focusKeys('client', track());
    expect(focusLevel(keys, 2)).toBe(1);
    expect(focusLevel(keys, 9)).toBe(0);
    expect(focusLevel(focusKeys('client', track({ changes: [] })), 2)).toBe(0);
  });

  it('dims the whole board while an overlay shows, with the overlay’s own timing', () => {
    const overlays = overlayToggles([element('enter', 2), element('exit', 3)], 0);
    const keys = focusKeys('api', track({ overlays }));
    expect(focusLevel(keys, 1)).toBe(0);
    expect(focusLevel(keys, 2 + ACTION_DURATION_SEC.enter)).toBe(1);
    expect(focusLevel(keys, 3 + ACTION_DURATION_SEC.exit)).toBe(0);
  });

  it('eases from wherever an interrupted change had got to', () => {
    const changes = [
      { sec: 0, ids: [], animate: false },
      { sec: 1, ids: ['other'], animate: true },
      { sec: 1.1, ids: [], animate: true },
    ];
    const keys = focusKeys('api', track({ changes }));
    const reached = focusLevel(keys, 1.1);
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(0.5);
    expect(focusLevel(keys, 1.1 + ACTION_DURATION_SEC.focus / 2)).toBeLessThan(reached);
  });

  it('is 0 before its first key', () => {
    expect(focusLevel([], 3)).toBe(0);
  });
});

describe('focusTrack', () => {
  it('keeps the focus and the overlay dims apart, the first overlay entrance animated', () => {
    const track = focusTrack('client', {
      changes: [{ sec: 0, ids: ['api'], animate: false }],
      overlays: overlayToggles([element('enter', 2)], 0),
      hostOf: noHosts,
    });
    expect(track.focus.map((k) => [k.sec, k.dim])).toEqual([[0, 1]]);
    expect(track.overlay.map((k) => [k.sec, k.dim, k.durationSec])).toEqual([
      [0, 0, 0],
      [2, 1, ACTION_DURATION_SEC.enter],
    ]);
  });
});
