import { spring } from 'remotion';

/** Seconds an enter animation takes; scaled by fps so drafts (15 fps) match finals (30 fps). */
const ENTER_SEC = 0.45;

/**
 * 0 before `from`, then springs to 1 (no overshoot). Every HUD animation starts at a frame
 * resolved from a word or beat-edge anchor, never at a fraction of scene time.
 */
export function enterProgress(frame: number, from: number, fps: number): number {
  if (frame < from) return 0;
  return spring({
    frame: frame - from,
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(ENTER_SEC * fps),
  });
}

/** CSS for an element sliding `distance` px along `axis` while it fades in. */
export function enterStyle(progress: number, distance: number, axis: 'x' | 'y' = 'y') {
  const offset = (1 - progress) * distance;
  return {
    opacity: progress,
    transform: axis === 'x' ? `translateX(${offset}px)` : `translateY(${offset}px)`,
  } as const;
}
