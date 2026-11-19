import {
  narrationWords,
  resolveAnchorSec,
  toJsonPath,
  type BeatTiming,
  type SceneEvent,
  type SpecError,
  type VideoSpec,
} from '@explainer-studio/shared';
import { eventStagger } from '../events/params.ts';
import { SCAN_MIN_STEP_SEC } from '../events/presets.ts';
import { scanStep, type AnchoredEvent } from '../events/resolve.ts';
import { eventParts } from '../primitives/parts.ts';
import type { Registries } from './registries.ts';
import { sceneScopes, type Scope } from './scope.ts';

/**
 * `scan_too_short`: a scan (`params.stagger: 'scan'`, in the spec or inside a pattern) whose
 * resolved step falls below `SCAN_MIN_STEP_SEC`, squeezed by the beat's next event (or by too
 * many items for `SCAN_MAX_SEC`), so it reads as one flash instead of a sweep. Uses the event
 * engine's own step (`scanStep`). Needs timing (real or estimated from the script).
 */

type Path = (string | number)[];

/** An anchored event with where it comes from in the spec and how many items it sweeps. */
type Located = { event: AnchoredEvent; path: Path; count: number; scan: boolean };

export function scanWarnings(
  spec: VideoSpec,
  beats: readonly BeatTiming[] | undefined,
  registries: Registries,
): SpecError[] {
  if (!beats) return [];
  const scenes = spec.scenes ?? [];
  const scopes = sceneScopes(scenes, registries);
  return scenes.flatMap((scene, i) => {
    const beat = beats.find((b) => b.beatId === scene.beatId);
    if (!beat) return [];
    const words = narrationWords(
      spec.script?.find((s) => s.beatId === scene.beatId)?.narration ?? '',
    );
    const scope = scopes[i] ?? new Map();
    const at = (event: SceneEvent, rename: (t: string) => string, path: Path) =>
      locate(event, rename, path, { beat, words, scope });
    const located = [
      ...scene.events.flatMap((e, k) => at(e, (t) => t, ['scenes', i, 'events', k])),
      ...scene.patterns.flatMap((p, j) =>
        expansionEvents(p.pattern, p.params, registries).flatMap((e) =>
          at(e, (t) => `${p.id}/${t}`, ['scenes', i, 'patterns', j]),
        ),
      ),
    ];
    const all = located.map((l) => l.event);
    return located.filter((l) => l.scan && l.count > 1).flatMap((l) => tooShort(l, all));
  });
}

type Ctx = { beat: BeatTiming; words: readonly string[]; scope: Scope };

function locate(
  event: SceneEvent,
  rename: (target: string) => string,
  path: Path,
  { beat, words, scope }: Ctx,
): Located[] {
  const sec = resolveAnchorSec(event.at, beat, words);
  if (sec === undefined) return [];
  const targets = event.targets.map(rename);
  const anchored: AnchoredEvent = {
    action: event.action,
    targets,
    ...(event.params ? { params: event.params } : {}),
    sec,
    beatStartSec: beat.startSec,
    beatEndSec: beat.endSec,
  };
  const scan = eventStagger(event.params) === 'scan';
  return [{ event: anchored, path, count: itemCount(targets, event.params, scope), scan }];
}

/** Items a scan sweeps: the target's parts (in its own order), else its elements. */
function itemCount(
  targets: readonly string[],
  params: Record<string, unknown> | undefined,
  scope: Scope,
): number {
  const parts = eventParts(params);
  const [target] = targets;
  if (parts && target !== undefined && targets.length === 1) {
    return scope.get(target)?.parts?.ids.length ?? parts.length;
  }
  return targets.reduce((sum, t) => sum + (scope.get(t)?.inner?.length ?? 1), 0);
}

function expansionEvents(id: string, params: unknown, registries: Registries): SceneEvent[] {
  const definition = registries.patterns.get(id);
  const parsed = definition?.paramsSchema.safeParse(params);
  return definition && parsed?.success ? definition.expand(parsed.data).events : [];
}

function tooShort(located: Located, all: readonly AnchoredEvent[]): SpecError[] {
  const step = scanStep(located.event, all, located.count);
  if (step >= SCAN_MIN_STEP_SEC) return [];
  const isEvent = located.path.at(-2) === 'events';
  return [
    {
      path: toJsonPath(isEvent ? [...located.path, 'params', 'stagger'] : located.path),
      code: 'scan_too_short',
      message:
        `A scan over ${located.count} items gets ${step.toFixed(2)} s per item (at least ` +
        `${SCAN_MIN_STEP_SEC} s reads as one by one). Anchor the beat's next event later, or ` +
        'scan fewer items.',
    },
  ];
}
