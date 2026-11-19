import {
  effectiveTiming,
  narrationWords,
  type EventAnchor,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import { ACTION_DURATION_SEC } from '../events/presets.ts';
import { eventParts } from '../primitives/parts.ts';
import { anchorToTime, secToFrame } from '../timing/frames.ts';

/**
 * Which moments a primitive sheet shows: one panel per event on the primitive's board beat,
 * sampled just before the next event (or the end of the beat), so each panel shows that event
 * fully played out. A `pulse` has faded by then, so it is sampled at its peak instead. Pure: the
 * still and its tests share it.
 */

export type SheetPanel = { caption: string; frame: number };

export const SHEET_COLUMNS = 2;

/** Height the panel grid gets on a 1920 px sheet (padding and header taken off). */
const GRID_HEIGHT = 1580;
const ROW_GAP = 24;
/** Panel chrome: a caption of up to two lines, its rule and the panel padding. */
const PANEL_CHROME = 110;
/** Panel width (1080 px sheet, two columns) minus padding and room for corner badges. */
const PANEL_INNER_WIDTH = 380;
const PANEL_INNER_MAX_HEIGHT = 400;

/** Room for the element inside each panel, so every row of panels fits the sheet. */
export function panelInner(panelCount: number): { width: number; height: number } {
  const rows = Math.max(1, Math.ceil(panelCount / SHEET_COLUMNS));
  const rowHeight = (GRID_HEIGHT - (rows - 1) * ROW_GAP) / rows;
  return {
    width: PANEL_INNER_WIDTH,
    height: Math.min(PANEL_INNER_MAX_HEIGHT, Math.floor(rowHeight - PANEL_CHROME)),
  };
}

export type SheetPlan = { beatId: string; elementId: string; panels: SheetPanel[] };

/** Longest wait after the last event, so a long beat tail does not hide a short effect. */
const LAST_PANEL_MAX_SEC = 2;

/** Where a pulse's bump peaks, as a fraction of its duration (its easing is linear). */
const PULSE_PEAK = 0.5;

export function planPrimitiveSheet(
  spec: RenderableVideoSpec,
  primitiveId: string,
  fps: number,
): SheetPlan | undefined {
  const scene = spec.scenes.find((s) => s.elements.some((e) => e.primitive === primitiveId));
  const element = scene?.elements.find((e) => e.primitive === primitiveId);
  const timing = effectiveTiming(spec);
  const beat = timing.beats.find((b) => b.beatId === scene?.beatId);
  if (!scene || !element || !beat) return undefined;
  const narration = spec.script.find((s) => s.beatId === scene.beatId)?.narration ?? '';
  const words = narrationWords(narration);
  const events = scene.events
    .filter((e) => e.targets.includes(element.id))
    .flatMap((e) => {
      const time = anchorToTime(e.at, beat, narration, fps);
      const caption = `${anchorCaption(e.at, words)} · ${actionCaption(e.action, e.params)}`;
      return time ? [{ frame: time.frame, action: e.action, caption }] : [];
    })
    .sort((a, b) => a.frame - b.frame);
  const beatEnd = secToFrame(beat.endSec, fps);
  const pulsePeak = Math.round(PULSE_PEAK * ACTION_DURATION_SEC.pulse * fps);
  const panels = events.map((event, i) => {
    const next = events[i + 1]?.frame ?? Math.min(beatEnd, event.frame + LAST_PANEL_MAX_SEC * fps);
    const settled = Math.max(event.frame, next - 1);
    const frame = event.action === 'pulse' ? Math.min(settled, event.frame + pulsePeak) : settled;
    return { caption: event.caption, frame };
  });
  return { beatId: scene.beatId, elementId: element.id, panels };
}

/** The action, followed by the parts it names: `lock h3+h4`. */
export function actionCaption(action: string, params: Record<string, unknown> | undefined): string {
  const parts = eventParts(params);
  return parts ? `${action} ${parts.join('+')}` : action;
}

/** `@"word"` for word anchors, `start+0.2s` / `end-0.5s` for beat edges. */
export function anchorCaption(anchor: EventAnchor, words: readonly string[]): string {
  if (anchor.type === 'word') return `@"${words[anchor.index] ?? `#${anchor.index}`}"`;
  if (anchor.type === 'word_text') {
    return anchor.occurrence > 1 ? `@"${anchor.text}" ×${anchor.occurrence}` : `@"${anchor.text}"`;
  }
  const sign = anchor.offsetSec < 0 ? '-' : '+';
  return `${anchor.edge}${sign}${Math.abs(anchor.offsetSec)}s`;
}
