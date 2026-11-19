import { describe, expect, it } from 'vitest';
import type { ElementEvent } from '../primitives/element-state.ts';
import { applyDrawOrder, type DrawOrderInput } from './draw-order.ts';
import { DRAW_MAX_SEC } from './presets.ts';

const FPS = 30;
const at = (action: ElementEvent['action'], sec: number, parts?: string[]): ElementEvent => ({
  action,
  sec,
  frame: Math.round(sec * FPS),
  beatEndSec: 20,
  ...(parts ? { params: { parts } } : {}),
});
const hosts: Record<string, string[]> = { tag: ['card'], stream: ['link'], badge: ['tag'] };
const input: DrawOrderInput = {
  fps: FPS,
  durationFor: (key) => (key === 'card' ? 0.8 : 0.5),
  hostsOf: (key) => hosts[key] ?? [],
};
const run = (events: Record<string, ElementEvent[]>) =>
  applyDrawOrder(new Map(Object.entries(events)), Object.keys(events), input);

describe('applyDrawOrder', () => {
  it('turns every whole-element enter into a draw of its own duration; parts keep the fade', () => {
    const out = run({ card: [at('enter', 1), at('enter', 2, ['a']), at('pulse', 3)] });
    expect(out.get('card')?.map((e) => e.drawSec)).toEqual([0.8, undefined, undefined]);
  });

  it('starts a follower at the later of its own enter and its host’s draw end', () => {
    const early = run({ card: [at('enter', 1)], tag: [at('enter', 1)] });
    expect(early.get('tag')?.[0]).toMatchObject({ sec: 1.8, frame: 54, drawSec: 0.5 });
    const late = run({ card: [at('enter', 1)], tag: [at('enter', 3)] });
    expect(late.get('tag')?.[0]?.sec).toBe(3);
  });

  it('waits for a host that starts a moment later (a staggered host)', () => {
    const out = run({ card: [at('enter', 1.06)], tag: [at('enter', 1)] });
    expect(out.get('tag')?.[0]?.sec).toBeCloseTo(1.86);
    const far = run({ card: [at('enter', 1 + DRAW_MAX_SEC + 1)], tag: [at('enter', 1)] });
    expect(far.get('tag')?.[0]?.sec).toBe(1);
  });

  it('enters a follower with no presence of its own when its host has drawn', () => {
    const out = run({ card: [at('enter', 1)], tag: [at('pulse', 4)] });
    expect(out.get('tag')?.map((e) => [e.action, e.sec])).toEqual([
      ['enter', 1.8],
      ['pulse', 4],
    ]);
    const present = run({ card: [], tag: [at('pulse', 4)] });
    expect(present.get('tag')?.map((e) => e.action)).toEqual(['pulse']);
  });

  it('chains followers: a badge on a tag on a card waits for both', () => {
    const out = run({ card: [at('enter', 1)], tag: [at('enter', 1)], badge: [] });
    expect(out.get('badge')?.[0]?.sec).toBeCloseTo(2.3);
  });

  it('starts a packet stream only after its connector has drawn', () => {
    const out = run({ link: [at('enter', 2)], stream: [at('enter', 2)] });
    expect(out.get('stream')?.[0]?.sec).toBeCloseTo(2.5);
  });
});
