import { smoothstep } from '../geometry.ts';

/** Seconds a `move` packet takes from start to end: fixed, never paced by the beat. */
export const PACKET_TRAVEL_SEC = 0.9;

/**
 * Where the `move` packet is (0..1 along the path), or undefined when none is in flight: before
 * the first `move` (elapsed is 0 while it is ahead) and once it has arrived.
 */
export function packetProgress(moveElapsed: number | undefined): number | undefined {
  if (moveElapsed === undefined || moveElapsed <= 0) return undefined;
  const t = moveElapsed / PACKET_TRAVEL_SEC;
  return t < 1 ? smoothstep(t) : undefined;
}
