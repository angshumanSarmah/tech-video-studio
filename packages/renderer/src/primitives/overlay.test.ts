import { describe, expect, it } from 'vitest';
import { IDLE_STATE } from './element-state.ts';
import { growView, riseView, ZOOM_FROM, zoomView } from './overlay.ts';

const at = (presence: number, dimmed = 0) => ({ ...IDLE_STATE, presence, dimmed });

describe('riseView', () => {
  it('rises into place as it fades in', () => {
    expect(riseView(at(0), 40)).toEqual({ opacity: 0, transform: 'translateY(40px) scale(1)' });
    expect(riseView(at(1), 40)).toEqual({ opacity: 1, transform: 'translateY(0px) scale(1)' });
  });

  it('fades when dimmed', () => {
    expect(riseView(at(1, 1), 40).opacity).toBeCloseTo(0.3);
  });
});

describe('zoomView', () => {
  it('zooms from a small card to full size and back', () => {
    expect(zoomView(at(0))).toEqual({ opacity: 0, transform: `scale(${ZOOM_FROM})` });
    expect(zoomView(at(0.5)).opacity).toBe(1);
    expect(zoomView(at(1)).transform).toBe('scale(1)');
  });
});

describe('growView', () => {
  it('grows from nothing at the centre', () => {
    expect(growView(at(0)).transform).toBe('scale(0)');
    expect(growView(at(1)).transform).toBe('scale(1)');
  });
});
