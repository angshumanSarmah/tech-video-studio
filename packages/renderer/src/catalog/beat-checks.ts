import {
  anchorWordIndex,
  effectiveTiming,
  EventAnchorSchema,
  narrationWords,
  resolveAnchorSec,
  toJsonPath,
  type BeatScene,
  type BeatTiming,
  type EffectiveTiming,
  type EventAnchor,
  type RenderableVideoSpec,
  type SpecError,
} from '@explainer-studio/shared';
import { endingStartSec, hasEndingCard } from '../ending/ending-state.ts';
import { analyse } from '../layout/analyse.ts';
import { beatLayoutMode, LAYOUT_MODES } from '../layout/modes.ts';
import { specLayout } from '../layout/spec-layout.ts';
import type { Transform } from '../layout/fit.ts';
import { elementState, type ElementEvent } from '../primitives/element-state.ts';
import { beatWorld, sceneChain, type WorldItem } from '../scene/beat-world.ts';
import { getTheme, type Theme } from '../theme/index.ts';
import { sceneEndSec } from '../timing/frames.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';
import { settledSec } from './settled.ts';

/**
 * Per-beat scene checks for agent output (P1C.7; the Curator reuses them, P1C.8): warnings, so
 * agents repair them; specs stay valid. Each beat needs a focus, at least one change that moves,
 * and something visibly new; a board holds at most `MAX_BOARD_UNITS` things at once; one word
 * carries at most `MAX_UNRELATED_CHANGES_PER_WORD` unrelated changes; a highlight never covers
 * the whole board; only a `semantic_zoom` beat zooms from the previous board; and nothing is
 * anchored under the ending card. Pure; run on a spec that passed validation.
 */

/**
 * Things on screen at once at a beat's settled moment: layout units (an element with its pins;
 * lines and overlays excluded) plus an overlay's children. Calibrated on the golden fixtures and
 * the pattern boards, whose busiest beat shows 7 (`split_brain`; `beat-checks.test.ts`
 * recomputes it): a pattern's own board must pass.
 */
export const MAX_BOARD_UNITS = 7;

/** Unrelated changes (events with no target in common) one word may carry. */
export const MAX_UNRELATED_CHANGES_PER_WORD = 2;

/** A highlight covering every unit of a board this full highlights nothing. */
export const HIGHLIGHT_EVERYTHING_MIN_UNITS = 3;

/** A camera that moves less than this between beats has not moved (scale, px). */
const CAMERA_EPSILON = { scale: 0.02, px: 8 };

/** After its word, when a highlight's targets have entered (staggers included). */
const HIGHLIGHT_LOOK_SEC = 0.5;

const FPS = 30;

type Path = (string | number)[];
type Ctx = {
  spec: RenderableVideoSpec;
  timing: EffectiveTiming;
  registries: Registries;
  theme: Theme;
};

export type BeatCheckOptions = { registries?: Registries; theme?: Theme };

export function beatCheckWarnings(
  spec: RenderableVideoSpec,
  { registries = DEFAULT_REGISTRIES, theme = getTheme() }: BeatCheckOptions = {},
): SpecError[] {
  const ctx: Ctx = { spec, timing: effectiveTiming(spec), registries, theme };
  return spec.scenes.flatMap((scene, i) => [
    ...focusMissing(ctx, scene, i),
    ...beatWithoutMotion(scene, i),
    ...beatWithoutChange(ctx, scene, i),
    ...zoomFromUnplanned(ctx, scene, i),
    ...eventsShareWord(ctx, scene, i),
    ...eventsUnderEndingCard(ctx, scene, i),
    ...boardChecks(ctx, scene, i),
  ]);
}

function warning(path: Path, code: string, message: string): SpecError {
  return { path: toJsonPath(path), code, message };
}

/** A board needs one focus: its first beat (or a later one, until the board has one) sets it. */
function focusMissing(ctx: Ctx, scene: BeatScene, i: number): SpecError[] {
  const chain = sceneChain(ctx.spec.scenes, scene.beatId);
  const focused = chain.some(
    (s) => s.focus.length > 0 || s.events.some((e) => e.action === 'focus'),
  );
  if (focused) return [];
  return [
    warning(
      ['scenes', i, 'focus'],
      'focus_missing',
      'The board has no focus: set `focus` to the one thing the viewer should watch (the rest ' +
        'dims), or move it there with a `focus` event.',
    ),
  ];
}

/** Every beat moves: an event on a word, or a pattern (which animates on its anchors). */
function beatWithoutMotion(scene: BeatScene, i: number): SpecError[] {
  if (scene.events.length > 0 || scene.patterns.length > 0) return [];
  return [
    warning(
      ['scenes', i, 'events'],
      'beat_without_motion',
      'Nothing moves in this beat: anchor at least one event (an enter, a highlight, a focus ' +
        'change) to the word where the narration says it, or add a pattern.',
    ),
  ];
}

/**
 * Every beat shows something new (P1C.8): a new element or pattern, a focus shift or a camera
 * move. A new board always counts when it has anything on it.
 */
function beatWithoutChange(ctx: Ctx, scene: BeatScene, i: number): SpecError[] {
  const adds = scene.elements.length > 0 || scene.patterns.length > 0;
  if (adds) return [];
  const previous = ctx.spec.scenes[i - 1];
  if (scene.continuesPrevious && previous) {
    const shifts = focusShifts(scene, previous) || cameraMoves(ctx, scene, previous);
    if (shifts) return [];
  }
  return [
    warning(
      ['scenes', i],
      'beat_without_change',
      scene.continuesPrevious
        ? 'The board looks the same as in the previous beat: add an element or pattern, or move ' +
            'the focus to what this beat is about.'
        : 'This board is empty: put what the beat is about on it.',
    ),
  ];
}

function focusShifts(scene: BeatScene, previous: BeatScene): boolean {
  if (scene.events.some((e) => e.action === 'focus')) return true;
  if (scene.focus.length === 0) return false;
  return [...scene.focus].sort().join() !== [...previous.focus].sort().join();
}

function cameraMoves(ctx: Ctx, scene: BeatScene, previous: BeatScene): boolean {
  const beats = specLayout(ctx.spec, ctx.theme, ctx.registries).beats;
  const a = beats.get(previous.beatId)?.camera;
  const b = beats.get(scene.beatId)?.camera;
  return a !== undefined && b !== undefined && !sameCamera(a, b);
}

function sameCamera(a: Transform, b: Transform): boolean {
  return (
    Math.abs(a.scale - b.scale) < CAMERA_EPSILON.scale &&
    Math.abs(a.dx - b.dx) < CAMERA_EPSILON.px &&
    Math.abs(a.dy - b.dy) < CAMERA_EPSILON.px
  );
}

/** Only a `semantic_zoom` beat zooms from the previous board (the plan schedules it after it). */
function zoomFromUnplanned(ctx: Ctx, scene: BeatScene, i: number): SpecError[] {
  if (scene.zoomFrom === undefined) return [];
  const device = ctx.spec.story.beats.find((b) => b.id === scene.beatId)?.device;
  if (device === 'semantic_zoom') return [];
  return [
    warning(
      ['scenes', i, 'zoomFrom'],
      'zoom_from_unplanned',
      'Only a beat the plan marks semantic_zoom may zoom from the previous board. Leave ' +
        '`zoomFrom` out and use another transition.',
    ),
  ];
}

/** A beat's anchored changes: its events, and each anchor in its patterns' `params.at`. */
type Anchored = { path: Path; anchor: EventAnchor; roots: readonly string[] };

export function beatAnchors(scene: BeatScene, i: number): Anchored[] {
  const events = scene.events.map((event, e) => ({
    path: ['scenes', i, 'events', e, 'at'],
    anchor: event.at,
    roots: event.targets.map(rootOf),
  }));
  const patterns = scene.patterns.flatMap((pattern, j) => {
    const at = (pattern.params as { at?: unknown }).at;
    if (typeof at !== 'object' || at === null) return [];
    return Object.entries(at).flatMap(([name, value]) => {
      const anchor = EventAnchorSchema.safeParse(value);
      if (!anchor.success) return [];
      return [
        {
          path: ['scenes', i, 'patterns', j, 'params', 'at', name],
          anchor: anchor.data,
          roots: [pattern.id],
        },
      ];
    });
  });
  return [...events, ...patterns];
}

/** `<instance>/<id>` belongs with its instance. */
function rootOf(target: string): string {
  const slash = target.indexOf('/');
  return slash < 0 ? target : target.slice(0, slash);
}

/** At most `MAX_UNRELATED_CHANGES_PER_WORD` unrelated changes on one word. */
function eventsShareWord(ctx: Ctx, scene: BeatScene, i: number): SpecError[] {
  const words = narrationOf(ctx, scene.beatId);
  const byWord = new Map<number, Anchored[]>();
  for (const anchored of beatAnchors(scene, i)) {
    const index = anchorWordIndex(anchored.anchor, words);
    if (index === undefined) continue;
    byWord.set(index, [...(byWord.get(index) ?? []), anchored]);
  }
  return [...byWord.entries()].flatMap(([index, anchored]) => {
    const groups = unrelatedGroups(anchored);
    if (groups.length <= MAX_UNRELATED_CHANGES_PER_WORD) return [];
    const extra = groups[MAX_UNRELATED_CHANGES_PER_WORD]?.[0];
    if (!extra) return [];
    return [
      warning(
        extra.path,
        'events_share_word',
        `Word ${index} ("${words[index] ?? ''}") carries ${groups.length} unrelated changes; at ` +
          `most ${MAX_UNRELATED_CHANGES_PER_WORD}. Move this one to the word where the ` +
          'narration says it.',
      ),
    ];
  });
}

/** Changes grouped by shared targets (connected components), in input order. */
function unrelatedGroups(anchored: readonly Anchored[]): Anchored[][] {
  const groups: { roots: Set<string>; items: Anchored[] }[] = [];
  for (const item of anchored) {
    const touching = groups.filter((g) => item.roots.some((r) => g.roots.has(r)));
    const merged = {
      roots: new Set([...item.roots, ...touching.flatMap((g) => [...g.roots])]),
      items: [...touching.flatMap((g) => g.items), item],
    };
    const first = touching[0] ? groups.indexOf(touching[0]) : groups.length;
    for (const g of touching) groups.splice(groups.indexOf(g), 1);
    groups.splice(Math.min(first, groups.length), 0, merged);
  }
  return groups.map((g) => g.items);
}

/** The card covers the final beat's last sentence: nothing may change under it. */
function eventsUnderEndingCard(ctx: Ctx, scene: BeatScene, i: number): SpecError[] {
  const { spec, timing } = ctx;
  if (i !== spec.scenes.length - 1 || !hasEndingCard(spec)) return [];
  const cardSec = endingStartSec(spec, timing);
  const beat = timingOf(ctx, scene.beatId);
  if (cardSec === undefined || !beat) return [];
  const words = narrationOf(ctx, scene.beatId);
  return beatAnchors(scene, i).flatMap(({ path, anchor }) => {
    const sec = resolveAnchorSec(anchor, beat, words);
    if (sec === undefined || sec < cardSec - 1e-6) return [];
    return [
      warning(
        path,
        'events_under_ending_card',
        "This change happens during the final beat's last sentence, which the ending card " +
          'covers. Anchor it to an earlier word.',
      ),
    ];
  });
}

/** Too busy a board, and a highlight on everything: both count what is on screen. */
function boardChecks(ctx: Ctx, scene: BeatScene, i: number): SpecError[] {
  const board = boardAt(ctx, scene);
  if (!board) return [];
  const beat = timingOf(ctx, scene.beatId);
  const end = sceneEndSec(ctx.timing, scene.beatId);
  const start = beat?.startSec ?? 0;
  const settled = settledSec(board.items.flatMap((item) => beatEvents(item, start, end)));
  const at = Math.min(settled ?? end, end - 1 / FPS);
  const shown = board.countAt(at);
  const busy =
    shown.count > MAX_BOARD_UNITS
      ? [
          warning(
            ['scenes', i],
            'board_too_busy',
            `${shown.count} things are on screen at once (at most ${MAX_BOARD_UNITS}): leave ` +
              'out or exit what this beat does not need, or move it to its own beat.',
          ),
        ]
      : [];
  return [...busy, ...highlightEverything(ctx, scene, i, board)];
}

type Board = {
  items: readonly WorldItem[];
  /** Units present at `sec` (their keys) and the count with overlay children. */
  countAt: (sec: number) => { units: string[]; count: number };
};

function boardAt(ctx: Ctx, scene: BeatScene): Board | undefined {
  const { spec, timing, registries, theme } = ctx;
  const first = sceneChain(spec.scenes, scene.beatId)[0];
  const mode = first ? LAYOUT_MODES.get(beatLayoutMode(first, registries.patterns)) : undefined;
  if (!mode) return undefined;
  const items = beatWorld(spec, timing, scene.beatId, FPS, registries);
  const present = (item: WorldItem, sec: number) =>
    item.kind === 'primitive' && elementState(item.events, Math.round(sec * FPS), FPS).presence > 0;
  return {
    items,
    countAt: (sec) => {
      const shown = items.filter((item) => present(item, sec));
      const units = analyse(shown, mode, new Set(), theme).units.map((u) => u.key);
      const children = shown
        .filter((item) => item.kind === 'primitive' && item.layer === 'overlay')
        .flatMap((item) => (item.kind === 'primitive' ? item.children : []))
        .filter((child) => present(child, sec));
      return { units, count: units.length + children.length };
    },
  };
}

/** A highlight whose targets cover every unit on a board of at least three highlights nothing. */
function highlightEverything(ctx: Ctx, scene: BeatScene, i: number, board: Board): SpecError[] {
  const beat = timingOf(ctx, scene.beatId);
  if (!beat) return [];
  const words = narrationOf(ctx, scene.beatId);
  return scene.events.flatMap((event, e) => {
    if (event.action !== 'highlight' || event.params?.parts !== undefined) return [];
    const sec = resolveAnchorSec(event.at, beat, words);
    if (sec === undefined) return [];
    const { units } = board.countAt(sec + HIGHLIGHT_LOOK_SEC);
    if (units.length < HIGHLIGHT_EVERYTHING_MIN_UNITS) return [];
    const covered = (key: string) =>
      event.targets.some((t) => t === key || key.startsWith(`${t}/`));
    if (!units.every(covered)) return [];
    return [
      warning(
        ['scenes', i, 'events', e, 'targets'],
        'highlight_everything',
        'This highlight covers everything on the board, so nothing stands out. Highlight the ' +
          'one thing the narration points at.',
      ),
    ];
  });
}

/** Events of an item (and its children) that start inside the beat's span. */
function beatEvents(item: WorldItem, startSec: number, endSec: number): ElementEvent[] {
  return eventsOf(item).filter((e) => e.sec >= startSec - 1e-6 && e.sec < endSec);
}

function eventsOf(item: WorldItem): ElementEvent[] {
  if (item.kind !== 'primitive') return [];
  return [...item.events, ...item.children.flatMap(eventsOf)];
}

function timingOf(ctx: Ctx, beatId: string): BeatTiming | undefined {
  return ctx.timing.beats.find((b) => b.beatId === beatId);
}

function narrationOf(ctx: Ctx, beatId: string): string[] {
  return narrationWords(ctx.spec.script.find((s) => s.beatId === beatId)?.narration ?? '');
}
