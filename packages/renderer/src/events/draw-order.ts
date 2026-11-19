import type { ElementEvent } from '../primitives/element-state.ts';
import { eventParts } from '../primitives/parts.ts';
import { secToFrame } from '../timing/frames.ts';
import { DRAW_MAX_SEC } from './presets.ts';

/**
 * The `draw` enter style's timing step, after `resolve.ts` (so group stagger and scans already
 * apply): every whole-element `enter` becomes a draw (`drawSec`, from the element's outline length
 * at a constant pen speed), and an element that follows a host (pinned to it, contained in it, or
 * a `follows` ref such as a packet stream on its connector) enters at the later of its own enter
 * and the end of its host's draw. A follower with no enter or exit of its own, which would show
 * from the start, enters when its host has drawn. Parts keep the fade. Pure.
 */

export type DrawOrderInput = {
  fps: number;
  /** Seconds the element's draw takes. */
  durationFor: (key: string) => number;
  /** The elements a key waits for (its pin host, its container, its `follows` refs). */
  hostsOf: (key: string) => readonly string[];
};

export function applyDrawOrder(
  byKey: ReadonlyMap<string, readonly ElementEvent[]>,
  keys: readonly string[],
  input: DrawOrderInput,
): Map<string, ElementEvent[]> {
  const out = new Map<string, ElementEvent[]>();
  const visiting = new Set<string>();
  const resolve = (key: string): ElementEvent[] => {
    const known = out.get(key);
    if (known) return known;
    const own = stamp(byKey.get(key) ?? [], input.durationFor(key));
    if (visiting.has(key)) return own;
    visiting.add(key);
    let events = own;
    for (const host of input.hostsOf(key)) {
      events = follow(events, hostDraws(resolve(host)), input.durationFor(key), input.fps);
    }
    const sorted = [...events].sort((a, b) => a.sec - b.sec);
    out.set(key, sorted);
    return sorted;
  };
  keys.forEach(resolve);
  return out;
}

const isWhole = (e: ElementEvent) => !eventParts(e.params);
const isPresence = (e: ElementEvent) => (e.action === 'enter' || e.action === 'exit') && isWhole(e);

/** Every whole-element enter draws, over `drawSec`. */
function stamp(events: readonly ElementEvent[], drawSec: number): ElementEvent[] {
  return events.map((e) => (e.action === 'enter' && isWhole(e) ? { ...e, drawSec } : e));
}

type HostDraw = { sec: number; endSec: number; beatEndSec: number };

function hostDraws(events: readonly ElementEvent[]): HostDraw[] {
  return events.flatMap((e) =>
    e.action === 'enter' && e.drawSec !== undefined && isWhole(e)
      ? [{ sec: e.sec, endSec: e.sec + e.drawSec, beatEndSec: e.beatEndSec }]
      : [],
  );
}

/**
 * A follower's enter moves to the end of the host's draw that is under way at it, or starts
 * within one `DRAW_MAX_SEC` after it (a staggered host), when that ends later; a follower with no
 * presence of its own enters at the end of each host draw.
 */
function follow(
  events: readonly ElementEvent[],
  draws: readonly HostDraw[],
  drawSec: number,
  fps: number,
): ElementEvent[] {
  if (draws.length === 0) return [...events];
  if (!events.some(isPresence)) {
    const enters = draws.map((d): ElementEvent => ({
      action: 'enter',
      sec: d.endSec,
      frame: secToFrame(d.endSec, fps),
      beatEndSec: d.beatEndSec,
      drawSec,
    }));
    return [...events, ...enters];
  }
  return events.map((e) => {
    if (e.action !== 'enter' || !isWhole(e)) return e;
    const host = draws.find((d) => d.endSec > e.sec && d.sec <= e.sec + DRAW_MAX_SEC);
    if (!host) return e;
    return { ...e, sec: host.endSec, frame: secToFrame(host.endSec, fps) };
  });
}
