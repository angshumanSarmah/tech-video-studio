import type { BeatScene } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import type { FramedEvent } from '../timing/frames.ts';
import { activeWordIndex, devTargets, devTargetState, displayWords } from './dev-state.ts';

const events: FramedEvent[] = [
  { action: 'enter', targets: ['a'], frame: 10 },
  { action: 'pulse', targets: ['a', 'b'], frame: 20 },
  { action: 'exit', targets: ['a'], frame: 40 },
];

describe('devTargetState', () => {
  it('hides a target until its enter event and after its exit', () => {
    expect(devTargetState('a', events, 5, 10).visible).toBe(false);
    expect(devTargetState('a', events, 10, 10).visible).toBe(true);
    expect(devTargetState('a', events, 40, 10).visible).toBe(false);
  });

  it('shows a target without an enter event from the start', () => {
    expect(devTargetState('b', events, 0, 10).visible).toBe(true);
  });

  it('flashes on other actions, fading over flashFrames', () => {
    expect(devTargetState('b', events, 20, 10)).toEqual({
      visible: true,
      lastAction: 'pulse',
      flash: 1,
    });
    expect(devTargetState('b', events, 25, 10).flash).toBeCloseTo(0.5);
    expect(devTargetState('b', events, 30, 10).flash).toBe(0);
  });
});

describe('devTargets', () => {
  it('lists elements, patterns, then ids inherited from the previous beat', () => {
    const scene: BeatScene = {
      beatId: 'b',
      kind: 'board',
      layoutMode: 'centered_focus',
      elements: [{ id: 'bucket', primitive: 'counter', props: {} }],
      patterns: [{ id: 'flood', pattern: 'flood_then_funnel', params: {} }],
      events: [{ at: { type: 'word', index: 0 }, action: 'dim', targets: ['api', 'bucket'] }],
      focus: [],
      transitionIn: 'cut',
      continuesPrevious: true,
    };
    expect(devTargets(scene).map((t) => t.id)).toEqual(['bucket', 'flood', 'api']);
  });
});

describe('displayWords / activeWordIndex', () => {
  it('keeps tokens as written, one per narration word', () => {
    expect(displayWords('No token, no request — wait.')).toEqual([
      'No',
      'token,',
      'no',
      'request',
      'wait.',
    ]);
  });

  it('finds the last word that has started', () => {
    const words = [0, 1, 2].map((i) => ({ text: `w${i}`, startSec: i, endSec: i + 0.5 }));
    expect(activeWordIndex(words, -0.1)).toBe(-1);
    expect(activeWordIndex(words, 1.7)).toBe(1);
    expect(activeWordIndex(words, 9)).toBe(2);
  });
});
