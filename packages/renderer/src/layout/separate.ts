import type { Rect } from '../theme/index.ts';
import { bottom, centre, inflate, overlaps, right } from './rect.ts';

/** Most push steps before giving up (the leftover overlap becomes an `overlap` warning). */
const MAX_STEPS = 400;

/**
 * Pushes overlapping rects apart in place, keeping `gap` between them: for the first overlapping
 * pair (in key order), the later one moves out along the axis where it overlaps least, away from
 * the earlier one's centre. Deterministic; stops when clear or after `MAX_STEPS`.
 */
export function separate(rects: Map<string, Rect>, keys: readonly string[], gap: number): void {
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const pair = firstOverlap(rects, keys, gap);
    if (!pair) return;
    const [a, b] = pair;
    const ra = rects.get(a);
    const rb = rects.get(b);
    if (!ra || !rb) return;
    rects.set(b, pushedOut(ra, rb, gap));
  }
}

function firstOverlap(
  rects: ReadonlyMap<string, Rect>,
  keys: readonly string[],
  gap: number,
): [string, string] | undefined {
  for (let i = 0; i < keys.length; i += 1) {
    const a = keys[i];
    const ra = a === undefined ? undefined : rects.get(a);
    if (!a || !ra) continue;
    for (let j = i + 1; j < keys.length; j += 1) {
      const b = keys[j];
      const rb = b === undefined ? undefined : rects.get(b);
      if (b && rb && overlaps(inflate(ra, gap / 2), inflate(rb, gap / 2))) return [a, b];
    }
  }
  return undefined;
}

/** `b` moved the shortest way out of `a` (plus the gap). */
function pushedOut(a: Rect, b: Rect, gap: number): Rect {
  const ca = centre(a);
  const cb = centre(b);
  const toRight = right(a) + gap - b.x;
  const toLeft = right(b) + gap - a.x;
  const down = bottom(a) + gap - b.y;
  const up = bottom(b) + gap - a.y;
  const dx = cb.x >= ca.x ? toRight : -toLeft;
  const dy = cb.y >= ca.y ? down : -up;
  return Math.abs(dx) <= Math.abs(dy) ? { ...b, x: b.x + dx } : { ...b, y: b.y + dy };
}
