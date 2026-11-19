import { clamp01 } from '../geometry.ts';

/**
 * Where the packets of a `packet_stream` are, from its state alone. Packets leave the source every
 * `1 / rate` seconds from `enter` and take a fixed time to arrive, so the stream fills from the
 * source and drains after `exit`, at any fps.
 */

/** Seconds a packet takes from source to target: fixed, never paced by the beat. */
export const STREAM_TRAVEL_SEC = 1.2;

/** Fraction of the path where a rejected stream is blocked. */
export const BLOCK_AT = 0.82;

/** Packets fade out over this stretch before the barrier. */
const BLOCK_FADE = 0.1;

export type StreamInput = {
  rate: number;
  /** Seconds since `enter`; undefined without one (a steady, frozen stream). */
  flowSec: number | undefined;
  /** Seconds since `exit`; 0 or undefined while no exit has started. */
  stopSec: number | undefined;
  blocked: boolean;
};

export type Packet = { t: number; opacity: number };

export function streamPackets(input: StreamInput): Packet[] {
  const fractions = packetFractions(input);
  return input.blocked
    ? fractions.flatMap(blockedPacket)
    : fractions.map((t) => ({ t, opacity: 1 }));
}

function packetFractions({ rate, flowSec, stopSec }: StreamInput): number[] {
  if (flowSec === undefined) return steadyFractions(rate);
  if (flowSec <= 0) return [];
  // An exit counts only when it came after the latest enter (it has less elapsed time).
  const stopped = stopSec !== undefined && stopSec > 0 && stopSec < flowSec;
  const lastEmit = stopped ? flowSec - stopSec : flowSec;
  const first = Math.max(0, Math.floor((flowSec - STREAM_TRAVEL_SEC) * rate));
  const out: number[] = [];
  for (let k = first; k / rate <= lastEmit; k += 1) {
    const t = (flowSec - k / rate) / STREAM_TRAVEL_SEC;
    if (t >= 0 && t <= 1) out.push(t);
  }
  return out;
}

/** Evenly spaced packets for a stream without `enter`: always flowing, drawn frozen. */
function steadyFractions(rate: number): number[] {
  const count = Math.max(1, Math.round(rate * STREAM_TRAVEL_SEC));
  return Array.from({ length: count }, (_, k) => (k + 0.5) / count);
}

function blockedPacket(t: number): Packet[] {
  if (t >= BLOCK_AT) return [];
  return [{ t, opacity: 1 - clamp01((t - (BLOCK_AT - BLOCK_FADE)) / BLOCK_FADE) }];
}
