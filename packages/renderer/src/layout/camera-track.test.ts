import { describe, expect, it } from 'vitest';
import { ZOOM_PUSH_FILL } from '../events/presets.ts';
import { cameraAt, zoomCamera, type CameraKey } from './camera-track.ts';
import { applyRect } from './fit.ts';

const at = (sec: number, scale: number, dx: number, durationSec = 1, push = false): CameraKey => ({
  sec,
  camera: { scale, dx, dy: 0 },
  durationSec,
  ...(push ? { push } : {}),
});

describe('cameraAt', () => {
  it('is the identity before the first key, and the first key settled from its start', () => {
    const keys = [at(2, 1.4, 10)];
    expect(cameraAt(keys, 1)).toEqual({ scale: 1, dx: 0, dy: 0 });
    expect(cameraAt(keys, 2)).toEqual({ scale: 1.4, dx: 10, dy: 0 });
  });

  it('eases from one key to the next over its duration', () => {
    const keys = [at(0, 1, 0, 0), at(2, 1.4, 40)];
    expect(cameraAt(keys, 2).scale).toBe(1);
    expect(cameraAt(keys, 2.5)).toEqual({ scale: 1.2, dx: 20, dy: 0 });
    expect(cameraAt(keys, 3).scale).toBe(1.4);
  });

  it('accelerates a push, and eases from wherever an interrupted move had got to', () => {
    const push = [at(0, 1, 0, 0), at(1, 2, 0, 1, true)];
    expect(cameraAt(push, 1.5).scale).toBeCloseTo(1.125);
    const interrupted = [at(0, 1, 0, 0), at(1, 2, 0), at(1.5, 1, 0)];
    const reached = cameraAt(interrupted, 1.5).scale;
    expect(reached).toBeCloseTo(1.5);
    expect(cameraAt(interrupted, 2).scale).toBeCloseTo(1.25);
  });

  it('is the same at any frame rate (seconds, not frames)', () => {
    const keys = [at(0, 1, 0, 0), at(1, 1.6, 30, 0.6)];
    expect(cameraAt(keys, 7 / 15 + 1)).toEqual(cameraAt(keys, 14 / 30 + 1));
  });
});

describe('zoomCamera', () => {
  it('fills the frame with the target, centred', () => {
    const frame = { x: 0, y: 100, width: 1000, height: 800 };
    const target = { x: 300, y: 400, width: 100, height: 50 };
    const camera = zoomCamera(target, frame, 1);
    const shown = applyRect(camera, target);
    expect(camera.scale).toBe(10);
    expect(shown).toEqual({ x: 0, y: 250, width: 1000, height: 500 });
  });

  it('pushes past filling by default, centred on the target', () => {
    const frame = { x: 0, y: 0, width: 1000, height: 1000 };
    const camera = zoomCamera({ x: 0, y: 0, width: 100, height: 100 }, frame);
    expect(camera.scale).toBe(10 * ZOOM_PUSH_FILL);
    expect(camera.dx + 50 * camera.scale).toBe(500);
  });
});
