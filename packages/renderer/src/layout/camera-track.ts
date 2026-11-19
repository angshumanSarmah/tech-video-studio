import { easeInCubic, easeInOutCubic, ZOOM_PUSH_FILL } from '../events/presets.ts';
import type { Rect } from '../theme/index.ts';
import type { Transform } from './fit.ts';
import { centre } from './rect.ts';

/**
 * A chain's camera over time: a key where each beat starts and where its focus changes (each
 * framed by `beatCamera`), and, before a semantic zoom, a push into the element the next beat
 * zooms from. Within a chain each key eases from wherever the camera had got to; the chain's first
 * key is settled (a new board snaps to its framing). Measured in global seconds, so a beat cut
 * (`BeatFromSpec`) renders exactly like the full video. Pure.
 */

export type CameraKey = {
  sec: number;
  camera: Transform;
  durationSec: number;
  /** A semantic-zoom push: accelerates into the element (ease-in) instead of easing both ways. */
  push?: boolean;
};

/** The camera at global `sec`; identity before the first key. */
export function cameraAt(keys: readonly CameraKey[], sec: number): Transform {
  let from: Transform | undefined;
  let active: CameraKey | undefined;
  for (const key of keys) {
    if (key.sec > sec) break;
    from = active && from ? keyCamera(active, from, key.sec) : key.camera;
    active = key;
  }
  return active && from ? keyCamera(active, from, sec) : { scale: 1, dx: 0, dy: 0 };
}

function keyCamera(key: CameraKey, from: Transform, sec: number): Transform {
  const t = key.durationSec > 0 ? (sec - key.sec) / key.durationSec : 1;
  const e = key.push ? easeInCubic(t) : easeInOutCubic(t);
  const lerp = (a: number, b: number) => a + (b - a) * e;
  return {
    scale: lerp(from.scale, key.camera.scale),
    dx: lerp(from.dx, key.camera.dx),
    dy: lerp(from.dy, key.camera.dy),
  };
}

/**
 * The camera centred on `target` (canvas px) at `fill` times the scale that fills `frame` with it:
 * the end of a semantic-zoom push (`ZOOM_PUSH_FILL`, into the element).
 */
export function zoomCamera(target: Rect, frame: Rect, fill = ZOOM_PUSH_FILL): Transform {
  const scale = fill * Math.min(frame.width / target.width, frame.height / target.height);
  const t = centre(target);
  const f = centre(frame);
  return { scale, dx: f.x - t.x * scale, dy: f.y - t.y * scale };
}
