import { describe, expect, it } from 'vitest';
import { goldenRateLimiterSpec } from '../../fixtures/index.ts';
import { INNER_TARGET_ACTIONS, PATTERN_INSTANCE_ACTIONS } from '../patterns/types.ts';
import { boardState } from './board-state.ts';

const entry = (beatId: string, id: string) => {
  const found = boardState(goldenRateLimiterSpec, beatId).entries.find((e) => e.id === id);
  if (!found) throw new Error(`no ${id} on ${beatId}'s board`);
  return found;
};

describe('boardState', () => {
  it("lists everything the board declared so far, with its text and the board's mode", () => {
    const state = boardState(goldenRateLimiterSpec, 'fleet-fix');
    expect(state.entries.map((e) => e.id)).toEqual([
      'user',
      'api-a',
      'api-b',
      'to-a',
      'to-b',
      'count-a',
      'count-b',
      'leak',
      'shared',
      'a-shared',
      'b-shared',
      'total',
    ]);
    expect(entry('fleet-fix', 'api-a')).toMatchObject({ type: 'node_card', text: 'API 1' });
    expect(state).toMatchObject({ mode: 'pipeline', maxUnits: 10 });
    expect(state.zones.length).toBeGreaterThan(0);
  });

  it('says what has exited and what still holds a reject, as the scene leaves the screen', () => {
    expect(entry('fleet', 'count-a').present).toBe(true);
    expect(entry('fleet-fix', 'count-a').present).toBe(false);
    expect(entry('fleet', 'leak')).toMatchObject({ present: true, held: ['rejected'] });
    expect(entry('hook', 'api').held).toEqual(['rejected']);
  });

  it('follows focus events to the focus at the end of the beat', () => {
    expect(boardState(goldenRateLimiterSpec, 'fleet').focus).toEqual(['leak']);
    expect(boardState(goldenRateLimiterSpec, 'fleet-fix').focus).toEqual(['shared', 'total']);
  });

  it('counts the units on screen', () => {
    expect(boardState(goldenRateLimiterSpec, 'hook').units).toBe(2);
    expect(boardState(goldenRateLimiterSpec, 'fleet-fix').units).toBe(4);
  });

  it('gives an element its actions, and an instance its inner ids with the inner actions', () => {
    expect(entry('hook', 'rps').actions).toContain('count');
    const flood = entry('payoff', 'flood');
    expect(flood).toMatchObject({ kind: 'pattern', type: 'flood_then_funnel', present: true });
    expect(flood.actions).toEqual(PATTERN_INSTANCE_ACTIONS);
    expect(flood.innerActions).toEqual(INNER_TARGET_ACTIONS);
    expect(flood.inner?.map((i) => i.id)).toContain('flood/target');
    expect(flood.inner?.every((i) => i.primitive.length > 0)).toBe(true);
  });
});
