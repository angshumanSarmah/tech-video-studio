import {
  estimateBeatTimings,
  narrationWords,
  resolveAnchorSec,
  toJsonPath,
  type BeatTiming,
  type EventAction,
  type SpecError,
  type VideoSpec,
} from '@explainer-studio/shared';
import { ACTION_DURATION_SEC } from '../events/presets.ts';
import { eventParts } from '../primitives/parts.ts';
import type { AnyPrimitiveDefinition } from '../primitives/types.ts';
import type { Registries } from './registries.ts';
import { scanWarnings } from './scan-checks.ts';

/**
 * Warnings that need each element's events in time order across its `continuesPrevious` chain:
 * a primitive's own `eventWarnings`, overlays that show at the same time (`overlay_overlap`),
 * contained children that act before their container enters (`child_before_container`), and
 * endings with nothing held to end (`recover_without_reject`, `release_without_lock`), and scans
 * squeezed below a readable step (`scan_too_short`, `scan-checks.ts`). Times
 * come from the timing layer, or are estimated from the script; without a script only the
 * primitives' own checks run.
 */

type Path = (string | number)[];

export type TimedEvent = {
  action: EventAction;
  parts?: string[];
  /** Global seconds; undefined without timing or when a word anchor matches nothing. */
  sec: number | undefined;
  path: Path;
};

/** One element with every event that acts on it, in the chain of beats it lives in. */
export type PlacedElement = {
  id: string;
  /** Index of its chain of `continuesPrevious` beats: ids are unique within one chain. */
  chain: number;
  path: Path;
  definition: AnyPrimitiveDefinition;
  props: unknown;
  /** Start of the beat that adds it and end of the last beat of its chain (with timing). */
  startSec: number | undefined;
  endSec: number | undefined;
  events: TimedEvent[];
};

export function findTimelineWarnings(spec: VideoSpec, registries: Registries): SpecError[] {
  const placed = placeElements(spec, registries);
  return [
    ...placed.flatMap(primitiveWarnings),
    ...overlayOverlapWarnings(placed),
    ...placed.flatMap((p) => childBeforeContainerWarnings(p, placed)),
    ...placed.flatMap(endingWarnings),
    ...scanWarnings(spec, specBeats(spec), registries),
  ];
}

export function placeElements(spec: VideoSpec, registries: Registries): PlacedElement[] {
  const beats = specBeats(spec);
  const placed: PlacedElement[] = [];
  let current = new Map<string, PlacedElement>();
  let chain = -1;
  (spec.scenes ?? []).forEach((scene, i) => {
    if (i === 0 || !scene.continuesPrevious) {
      current = new Map();
      chain += 1;
    }
    const beat = beats?.find((b) => b.beatId === scene.beatId);
    scene.elements.forEach((element, j) => {
      const definition = registries.primitives.get(element.primitive);
      const props = definition?.propsSchema.safeParse(element.props);
      current.delete(element.id);
      if (!definition || !props?.success) return;
      const entry: PlacedElement = {
        id: element.id,
        chain,
        path: ['scenes', i, 'elements', j],
        definition,
        props: props.data,
        startSec: beat?.startSec,
        endSec: beat?.endSec,
        events: [],
      };
      current.set(element.id, entry);
      placed.push(entry);
    });
    for (const entry of current.values()) entry.endSec = beat?.endSec ?? entry.endSec;
    const narration = spec.script?.find((s) => s.beatId === scene.beatId)?.narration ?? '';
    const words = narrationWords(narration);
    scene.events.forEach((event, e) => {
      const sec = beat ? resolveAnchorSec(event.at, beat, words) : undefined;
      const parts = eventParts(event.params);
      const timed = {
        action: event.action,
        ...(parts ? { parts } : {}),
        sec,
        path: ['scenes', i, 'events', e],
      };
      for (const target of event.targets) current.get(target)?.events.push(timed);
    });
  });
  return placed;
}

/** Real timing when present, else estimated from the script; undefined before the script. */
function specBeats(spec: VideoSpec): BeatTiming[] | undefined {
  if (spec.timing) return spec.timing.beats;
  return spec.script ? estimateBeatTimings(spec.script) : undefined;
}

function primitiveWarnings(p: PlacedElement): SpecError[] {
  if (!p.definition.eventWarnings) return [];
  const summaries = p.events.map(({ action, parts }) => (parts ? { action, parts } : { action }));
  return p.definition.eventWarnings(p.props, summaries).map((w) => ({
    path: toJsonPath(p.path),
    code: w.code,
    message: w.message,
  }));
}

export type Window = { from: number; to: number };

/**
 * When an element is visible: from the start of its beat (or its first `enter`, when that is its
 * first presence event) to the end of its `exit` fade or of its chain. Whole-element events only.
 */
export function presenceWindows(events: readonly TimedEvent[], startSec: number, endSec: number) {
  const presence = events
    .filter((e) => (e.action === 'enter' || e.action === 'exit') && !e.parts)
    .filter((e): e is TimedEvent & { sec: number } => e.sec !== undefined)
    .sort((a, b) => a.sec - b.sec);
  const windows: Window[] = [];
  let open: number | undefined = presence[0]?.action === 'enter' ? undefined : startSec;
  for (const event of presence) {
    if (event.action === 'enter' && open === undefined) open = event.sec;
    if (event.action === 'exit' && open !== undefined) {
      windows.push({ from: open, to: Math.min(endSec, event.sec + ACTION_DURATION_SEC.exit) });
      open = undefined;
    }
  }
  if (open !== undefined) windows.push({ from: open, to: endSec });
  return windows;
}

/** Overlap shorter than this (seconds) is rounding, not two overlays on screen. */
const OVERLAP_EPSILON_SEC = 0.01;

function windowsOf(p: PlacedElement): Window[] {
  if (p.startSec === undefined || p.endSec === undefined) return [];
  return presenceWindows(p.events, p.startSec, p.endSec);
}

/** At most one overlay may be visible at a time; reported on the later one. */
function overlayOverlapWarnings(placed: readonly PlacedElement[]): SpecError[] {
  const overlays = placed.filter((p) => p.definition.layer === 'overlay');
  return overlays.flatMap((later, k) =>
    overlays.slice(0, k).flatMap((earlier) => {
      const overlap = firstOverlap(windowsOf(earlier), windowsOf(later));
      if (!overlap) return [];
      return [
        {
          path: toJsonPath(later.path),
          code: 'overlay_overlap',
          message:
            `"${later.id}" (${later.definition.id}) shows while "${earlier.id}" ` +
            `(${earlier.definition.id}) is still visible, ${secs(overlap.from)}–` +
            `${secs(overlap.to)}. Show one overlay at a time: exit one before the next enters.`,
        },
      ];
    }),
  );
}

function firstOverlap(a: readonly Window[], b: readonly Window[]): Window | undefined {
  for (const x of a) {
    for (const y of b) {
      const from = Math.max(x.from, y.from);
      const to = Math.min(x.to, y.to);
      if (to - from > OVERLAP_EPSILON_SEC) return { from, to };
    }
  }
  return undefined;
}

/**
 * A contained child is hidden until its container enters, so its events before that are wasted
 * (allowed, but warned on each event).
 */
function childBeforeContainerWarnings(
  container: PlacedElement,
  placed: readonly PlacedElement[],
): SpecError[] {
  const enter = firstEnterSec(container.events);
  if (enter === undefined || !container.definition.elementRefs) return [];
  const childIds = container.definition
    .elementRefs(container.props)
    .filter((ref) => ref.contains)
    .map((ref) => ref.id);
  return childIds.flatMap((id) => {
    const child = placed.find((p) => p.chain === container.chain && p.id === id);
    return (child?.events ?? [])
      .filter((e) => e.sec !== undefined && e.sec < enter - OVERLAP_EPSILON_SEC)
      .map((e) => ({
        path: toJsonPath(e.path),
        code: 'child_before_container',
        message:
          `"${id}" acts (${e.action}) before its container "${container.id}" enters at ` +
          `${secs(enter)}; it is hidden until then. Anchor it at or after the container's enter.`,
      }));
  });
}

/** Seconds of the element's first whole-element `enter`, when that is its first presence event. */
function firstEnterSec(events: readonly TimedEvent[]): number | undefined {
  const first = events
    .filter((e) => (e.action === 'enter' || e.action === 'exit') && !e.parts && e.sec !== undefined)
    .sort((a, b) => (a.sec ?? 0) - (b.sec ?? 0))[0];
  return first?.action === 'enter' ? first.sec : undefined;
}

/** Each ending action, the held action it ends, and the warning when nothing is held. */
const ENDINGS = [
  { ending: 'recover', held: 'reject', code: 'recover_without_reject' },
  { ending: 'release', held: 'lock', code: 'release_without_lock' },
] as const;

/**
 * A `recover` (`release`) ends a held `reject` (`lock`) on the same element or part; one with no
 * earlier reject (lock) still held there does nothing. Whole-element and part states are apart.
 */
function endingWarnings(p: PlacedElement): SpecError[] {
  const ordered = inTimeOrder(p.events);
  const tracks = new Set(ordered.flatMap((e) => e.parts ?? ['']));
  return ENDINGS.flatMap(({ ending, held, code }) =>
    [...tracks].flatMap((track) => {
      let heldSince: TimedEvent | undefined;
      const problems: SpecError[] = [];
      for (const event of ordered.filter((e) => (e.parts ?? ['']).includes(track))) {
        if (event.action === held) heldSince = event;
        if (event.action !== ending) continue;
        if (!heldSince || !strictlyBefore(heldSince, event)) {
          const what = track ? `part "${track}" of "${p.id}"` : `"${p.id}"`;
          problems.push({
            path: toJsonPath(event.path),
            code,
            message:
              `${what} ${ending}s with no ${held} held before it, so it does nothing. ` +
              `A ${ending} only ends an earlier ${held} on the same element or part.`,
          });
        }
        heldSince = undefined;
      }
      return problems;
    }),
  );
}

/** By resolved seconds when every event has them; otherwise in spec order. */
function inTimeOrder(events: readonly TimedEvent[]): TimedEvent[] {
  if (events.some((e) => e.sec === undefined)) return [...events];
  return [...events].sort((a, b) => (a.sec ?? 0) - (b.sec ?? 0));
}

function strictlyBefore(a: TimedEvent, b: TimedEvent): boolean {
  return a.sec === undefined || b.sec === undefined || a.sec < b.sec - OVERLAP_EPSILON_SEC;
}

function secs(sec: number): string {
  return `${sec.toFixed(1)}s`;
}
