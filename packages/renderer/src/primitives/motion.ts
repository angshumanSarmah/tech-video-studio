/** Shakes this many times while a `reject` plays out. */
const SHAKES = 3;

/**
 * Horizontal offset in px of a reject shake: a decaying sine over the action's progress, 0 before
 * it starts and once it has finished.
 */
export function shakeOffset(progress: number, amplitude: number): number {
  if (progress <= 0 || progress >= 1) return 0;
  return amplitude * (1 - progress) * Math.sin(progress * SHAKES * 2 * Math.PI);
}
