import type { Point } from '../primitives/geometry.ts';
import type { ElementEvent } from '../primitives/element-state.ts';
import type { Rect, Zone } from '../theme/index.ts';
import { applyPoint, applyRect, avoidConflicts, IDENTITY, type Transform } from './fit.ts';
import { centre, inflate, inside, union } from './rect.ts';
import type { PlacedItem } from './types.ts';

/**
 * The per-beat camera: positions are fixed for a whole `continuesPrevious` chain, and each beat
 * frames the elements it shows with one uniform zoom and a translation of the board layer, biased
 * towards its focus. Never below the fitted layout (zoom ≥ 1), never above `MAX_ZOOM`, every
 * visible element inside the frame and clear of the avoid zones. Beats snap from one camera to the
 * next (P1A.10 eases between them). Pure.
 */

export const MAX_ZOOM = 1.6;

/** How far (0..1) the camera centre moves from the visible elements' centre towards the focus. */
export const FOCUS_BIAS = 0.5;

/** Zoom steps tried, from the best fit down to 1, when a zoom would put an element in a zone. */
const ZOOM_STEP = 0.05;

/**
 * True when an element is on screen at some point of [startSec, endSec): present at the start
 * (from the start unless its first enter/exit is an enter; then by its last enter/exit before the
 * start), or entering during the beat.
 */
export function visibleDuring(
  events: readonly Pick<ElementEvent, 'action' | 'sec'>[],
  startSec: number,
  endSec: number,
): boolean {
  const toggles = events.filter((e) => e.action === 'enter' || e.action === 'exit');
  let present = toggles[0]?.action !== 'enter';
  for (const e of toggles) {
    if (e.sec < startSec) present = e.action === 'enter';
    else if (e.sec < endSec && e.action === 'enter') return true;
  }
  return present;
}

export type CameraInput = {
  /** The chain's board items (canvas px, before the camera). */
  items: readonly PlacedItem[];
  /** Keys of the items this beat shows. */
  visible: ReadonlySet<string>;
  /** This beat's focus keys (only visible ones count). */
  focus: readonly string[];
  frame: Rect;
  avoidZones: readonly Zone[];
  /** Air kept around the framed elements (canvas px). */
  margin: number;
};

export function beatCamera(input: CameraInput): Transform {
  const shown = input.items.filter((i) => input.visible.has(i.key));
  const bounds = union(shown.map(shapeRect));
  if (!bounds) return IDENTITY;
  const target = inflate(bounds, input.margin);
  const best = Math.min(
    MAX_ZOOM,
    input.frame.width / target.width,
    input.frame.height / target.height,
  );
  const focusRect = union(shown.filter((i) => input.focus.includes(i.key)).map(shapeRect));
  for (let zoom = Math.max(1, best); zoom >= 1 - 1e-9; zoom -= ZOOM_STEP) {
    const camera = framing(zoom, target, focusRect, input.frame);
    if (camera && clear(shown, camera, input)) return camera;
  }
  return IDENTITY;
}

/** Zoom about the canvas origin, centred between the elements and their focus, kept in frame. */
function framing(
  zoom: number,
  target: Rect,
  focus: Rect | undefined,
  frame: Rect,
): Transform | undefined {
  const c = centre(target);
  const f = focus ? centre(focus) : c;
  const aim = { x: c.x + FOCUS_BIAS * (f.x - c.x), y: c.y + FOCUS_BIAS * (f.y - c.y) };
  const fc = centre(frame);
  const clampAxis = (want: number, lo: number, hi: number) => Math.min(Math.max(want, lo), hi);
  const dx = clampAxis(
    fc.x - aim.x * zoom,
    frame.x - target.x * zoom,
    frame.x + frame.width - (target.x + target.width) * zoom,
  );
  const dy = clampAxis(
    fc.y - aim.y * zoom,
    frame.y - target.y * zoom,
    frame.y + frame.height - (target.y + target.height) * zoom,
  );
  const camera = { scale: zoom, dx, dy };
  return inside(frame, applyRect(camera, target)) ? camera : undefined;
}

function clear(shown: readonly PlacedItem[], camera: Transform, input: CameraInput): boolean {
  const rects = new Map<string, Rect>();
  const paths = new Map<string, readonly Point[]>();
  for (const item of shown) {
    rects.set(item.key, applyRect(camera, item.rect));
    if (item.path)
      paths.set(
        item.key,
        canvasPath(item).map((p) => applyPoint(camera, p)),
      );
  }
  return avoidConflicts({ rects, paths }, input.avoidZones).length === 0;
}

function canvasPath(item: PlacedItem): Point[] {
  return (item.path ?? []).map((p) => ({
    x: item.rect.x + p.x * item.scale,
    y: item.rect.y + p.y * item.scale,
  }));
}

/** The room an item takes: its rect (a connector's includes its label band). */
function shapeRect(item: PlacedItem): Rect {
  return item.rect;
}
