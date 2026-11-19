import type { BeatScene } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import type { BeatFrameSpan } from '../timing/frames.ts';
import {
  activeView,
  incomingTransition,
  sceneSpans,
  transitionFrames,
  transitionView,
  type ActiveTransition,
} from './transitions.ts';

const scene = (beatId: string, more: Partial<BeatScene> = {}): BeatScene => ({
  beatId,
  kind: 'board',
  elements: [],
  patterns: [],
  events: [],
  focus: [],
  transitionIn: 'cut',
  continuesPrevious: false,
  ...more,
});
const spans: BeatFrameSpan[] = [
  { beatId: 'a', from: 0, durationInFrames: 90 },
  { beatId: 'b', from: 90, durationInFrames: 60 },
  { beatId: 'c', from: 150, durationInFrames: 60 },
];
const FPS = 30;
const T = transitionFrames(FPS);

describe('incomingTransition', () => {
  it('has none on the first beat, a continuing beat or a cut', () => {
    expect(incomingTransition(scene('a', { transitionIn: 'fade' }), 0)).toBeUndefined();
    const continuing = scene('b', { transitionIn: 'fade', continuesPrevious: true });
    expect(incomingTransition(continuing, 1)).toBeUndefined();
    expect(incomingTransition(scene('b'), 1)).toBeUndefined();
    expect(incomingTransition(scene('b', { transitionIn: 'slide' }), 1)).toEqual({
      kind: 'slide',
      semantic: false,
    });
  });

  it('marks a zoom-in with zoomFrom as a semantic zoom', () => {
    const zoom = scene('b', { transitionIn: 'zoom-in', zoomFrom: 'server' });
    expect(incomingTransition(zoom, 1)).toEqual({ kind: 'zoom-in', semantic: true });
  });
});

describe('sceneSpans', () => {
  it('runs the outgoing scene on under an overlapping transition', () => {
    const scenes = [scene('a'), scene('b', { transitionIn: 'fade' }), scene('c')];
    const out = sceneSpans(spans, scenes, FPS);
    expect(out.map((s) => s.durationInFrames)).toEqual([90 + T, 60, 60]);
    expect(out[0]?.transitions).toEqual([
      { kind: 'fade', side: 'out', semantic: false, from: 90, frames: T },
    ]);
    expect(out[1]?.transitions.map((t) => t.side)).toEqual(['in']);
  });

  it('cuts into a semantic zoom (the push happened on the previous camera)', () => {
    const scenes = [scene('a'), scene('b', { transitionIn: 'zoom-in', zoomFrom: 'x' }), scene('c')];
    const out = sceneSpans(spans, scenes, FPS);
    expect(out[0]).toMatchObject({ durationInFrames: 90, transitions: [] });
    expect(out[1]?.transitions).toEqual([
      { kind: 'zoom-in', side: 'in', semantic: true, from: 90, frames: T },
    ]);
  });

  it('shows every transition as a cut for one beat cut from the timeline', () => {
    const scenes = [scene('a'), scene('b', { transitionIn: 'slide' }), scene('c')];
    const out = sceneSpans(spans, scenes, FPS, { cuts: true });
    expect(out).toEqual(spans.map((s) => ({ ...s, transitions: [] })));
  });
});

describe('transitionView', () => {
  const t = (kind: ActiveTransition['kind'], side: 'in' | 'out', semantic = false) => ({
    kind,
    side,
    semantic,
    from: 100,
    frames: 12,
  });

  it('is undefined outside its window, so the scene is drawn as is', () => {
    expect(transitionView(t('fade', 'in'), 99)).toBeUndefined();
    expect(transitionView(t('fade', 'in'), 112)).toBeUndefined();
    expect(transitionView(t('cut', 'in'), 105)).toBeUndefined();
  });

  it('fades the incoming board over the outgoing one, which stays put', () => {
    expect(transitionView(t('fade', 'in'), 100)?.opacity).toBe(0);
    expect(transitionView(t('fade', 'in'), 106)?.opacity).toBeCloseTo(0.5);
    expect(transitionView(t('fade', 'out'), 106)).toBeUndefined();
  });

  it('slides the incoming board in from the right while the outgoing one leaves left', () => {
    expect(transitionView(t('slide', 'in'), 100)?.shift).toBe(1);
    expect(transitionView(t('slide', 'out'), 106)?.shift).toBeCloseTo(-0.5);
  });

  it('zooms in (the old board grows away, the new one grows in) and out (the reverse)', () => {
    const zoomIn = transitionView(t('zoom-in', 'in'), 100);
    expect(zoomIn).toEqual({ opacity: 0, scale: 0.85, shift: 0 });
    expect(transitionView(t('zoom-in', 'out'), 111)?.scale).toBeGreaterThan(1.25);
    expect(transitionView(t('zoom-out', 'in'), 100)?.scale).toBe(1.2);
    expect(transitionView(t('zoom-out', 'out'), 111)?.scale).toBeLessThan(0.85);
  });

  it('settles a semantic zoom’s new board, fully opaque (a cut)', () => {
    expect(transitionView(t('zoom-in', 'in', true), 100)).toEqual({
      opacity: 1,
      scale: 0.9,
      shift: 0,
    });
  });

  it('picks whichever transition is active', () => {
    const list = [t('slide', 'in'), { ...t('fade', 'out'), from: 200 }];
    expect(activeView(list, 105)?.shift).toBeGreaterThan(0);
    expect(activeView(list, 150)).toBeUndefined();
  });
});
