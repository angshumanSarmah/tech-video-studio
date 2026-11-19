import {
  effectiveTiming,
  EventAnchorSchema,
  narrationWords,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import type { Registries } from '../catalog/registries.ts';
import { LAYOUT_MODES } from '../layout/modes.ts';
import type { Size } from '../primitives/types.ts';
import { anchorToTime, secToFrame } from '../timing/frames.ts';
import { anchorCaption, type SheetPanel } from './primitive-sheet.ts';

/**
 * Which moments a pattern sheet shows and how it groups the beat's elements. Pure: the still and
 * its tests share it. One panel per narration anchor of the pattern, sampled just before the next
 * anchor (or up to 2 s later, within the beat), so each panel shows that moment played out. The
 * board is drawn as one row per zone of the layout mode (relational elements last): a review aid
 * that shows each element's zone, not the layout engine's placement (P1A.9).
 */

export type PatternSheetPlan = {
  beatId: string;
  instanceId: string;
  layoutMode: string;
  panels: SheetPanel[];
};

/** Longest wait after the last anchor, so a long beat tail does not hide a short effect. */
const LAST_PANEL_MAX_SEC = 2;

export function planPatternSheet(
  spec: RenderableVideoSpec,
  patternId: string,
  fps: number,
  registries: Registries,
): PatternSheetPlan | undefined {
  const definition = registries.patterns.get(patternId);
  const scene = spec.scenes.find((s) => s.patterns.some((p) => p.pattern === patternId));
  const instance = scene?.patterns.find((p) => p.pattern === patternId);
  const beat = effectiveTiming(spec).beats.find((b) => b.beatId === scene?.beatId);
  if (!definition || !scene || !instance || !beat) return undefined;
  const narration = spec.script.find((s) => s.beatId === scene.beatId)?.narration ?? '';
  const words = narrationWords(narration);
  const at = (instance.params as { at?: Record<string, unknown> }).at ?? {};
  const moments = definition.anchors
    .flatMap((anchor) => {
      const parsed = EventAnchorSchema.safeParse(at[anchor.name]);
      const time = parsed.success ? anchorToTime(parsed.data, beat, narration, fps) : undefined;
      if (!parsed.success || !time) return [];
      return [
        { frame: time.frame, caption: `${anchor.name} · ${anchorCaption(parsed.data, words)}` },
      ];
    })
    .sort((a, b) => a.frame - b.frame);
  const beatEnd = secToFrame(beat.endSec, fps);
  const panels = moments.map((moment, i) => {
    const next =
      moments[i + 1]?.frame ?? Math.min(beatEnd, moment.frame + LAST_PANEL_MAX_SEC * fps);
    return { caption: moment.caption, frame: Math.max(moment.frame, next - 1) };
  });
  return {
    beatId: scene.beatId,
    instanceId: instance.id,
    layoutMode: scene.layoutMode ?? definition.layoutMode,
    panels,
  };
}

/** Label of the row that holds elements without a zone (connectors, streams, brackets, rings). */
export const RELATIONS_ROW = 'relations';

export type ZoneRow<T> = { zone: string; items: T[] };

/**
 * Items grouped into one row per zone, in the layout mode's zone order, then a row for items
 * without a known zone. Empty rows are left out.
 */
export function zoneRows<T extends { zone?: string | undefined }>(
  items: readonly T[],
  layoutMode: string,
): ZoneRow<T>[] {
  const zones = LAYOUT_MODES.get(layoutMode)?.zones ?? [];
  const rows = zones.map((zone) => ({ zone, items: items.filter((i) => i.zone === zone) }));
  const rest = items.filter((i) => i.zone === undefined || !zones.includes(i.zone));
  return [...rows, { zone: RELATIONS_ROW, items: rest }].filter((row) => row.items.length > 0);
}

/** Natural size of rows of boxes laid out left to right, stacked top to bottom. */
export function rowsSize(rows: readonly (readonly Size[])[], gap: number): Size {
  const widths = rows.map(
    (row) => row.reduce((sum, b) => sum + b.width, 0) + gap * (row.length - 1),
  );
  const heights = rows.map((row) => Math.max(0, ...row.map((b) => b.height)));
  return {
    width: Math.max(0, ...widths),
    height: heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, rows.length - 1),
  };
}

/** Height the panel stack gets on a 1920 px sheet (padding and header taken off). */
const STACK_HEIGHT = 1580;
const PANEL_GAP = 24;
/** Panel chrome: a one-line caption, its rule and the body padding. */
const PANEL_CHROME = 80;
/** Panel body width on a 1080 px sheet, padding taken off. */
const PANEL_INNER_WIDTH = 940;

/** Room for the rows inside each panel, so every panel fits the sheet. */
export function patternPanelRoom(panelCount: number): Size {
  const count = Math.max(1, panelCount);
  const panelHeight = (STACK_HEIGHT - (count - 1) * PANEL_GAP) / count;
  return { width: PANEL_INNER_WIDTH, height: Math.floor(panelHeight - PANEL_CHROME) };
}

/** Scale that fits `size` into `room`, never enlarging. */
export function fitScale(size: Size, room: Size): number {
  if (size.width <= 0 || size.height <= 0) return 1;
  return Math.min(1, room.width / size.width, room.height / size.height);
}
