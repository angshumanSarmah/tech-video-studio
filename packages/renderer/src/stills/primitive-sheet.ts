import {
  effectiveTiming,
  narrationWords,
  type EventAnchor,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import { ACTION_DURATION_SEC } from '../primitives/element-state.ts';
import { anchorToTime, secToFrame } from '../timing/frames.ts';

/**
 * Which moments a primitive sheet shows: one panel per event on the primitive's board beat,
 * sampled just before the next event (or the end of the beat), so each panel shows that event
 * fully played out. A `pulse` has faded by then, so it is sampled at its peak instead. Pure: the
 * still and its tests share it.
 */

export type SheetPanel = { caption: string; frame: number };

export type SheetPlan = { beatId: string; elementId: string; panels: SheetPanel[] };

/** Longest wait after the last event, so a long beat tail does not hide a short effect. */
const LAST_PANEL_MAX_SEC = 2;

/** Where a pulse's bump peaks, as a fraction of its duration (ease-out cubic reaches 0.5 here). */
const PULSE_PEAK = 1 - 0.5 ** (1 / 3);

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
      const caption = `${anchorCaption(e.at, words)} · ${e.action}`;
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

/** `@"word"` for word anchors, `start+0.2s` / `end-0.5s` for beat edges. */
export function anchorCaption(anchor: EventAnchor, words: readonly string[]): string {
  if (anchor.type === 'word') return `@"${words[anchor.index] ?? `#${anchor.index}`}"`;
  if (anchor.type === 'word_text') {
    return anchor.occurrence > 1 ? `@"${anchor.text}" ×${anchor.occurrence}` : `@"${anchor.text}"`;
  }
  const sign = anchor.offsetSec < 0 ? '-' : '+';
  return `${anchor.edge}${sign}${Math.abs(anchor.offsetSec)}s`;
}
