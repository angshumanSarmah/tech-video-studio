import { splitInnerTarget } from '../ids.ts';
import { findWordOccurrence, narrationWords } from '../narration.ts';
import type { BeatScene, EventAnchor } from '../scene.ts';
import type { VideoSpec } from '../shape.ts';
import { findDuplicateIds, unknownReference, type SpecIssue } from './issue.ts';

/**
 * Scene checks. They assume the scene layer covers story beats in order (checked separately);
 * `continuesPrevious` refers to the previous entry.
 */
export function checkScenes(spec: VideoSpec): SpecIssue[] {
  const scenes = spec.scenes ?? [];
  const scopes = targetScopes(scenes);
  const wordsByBeat = new Map(
    (spec.script ?? []).map((s) => [s.beatId, narrationWords(s.narration)]),
  );
  return scenes.flatMap((scene, i) => [
    ...checkSceneIds(scene, i),
    ...checkInheritedIds(scene, i, scene.continuesPrevious ? scopes[i - 1] : undefined),
    ...checkContinuation(scene, i),
    ...checkTargets(scene, i, scopes[i] ?? { ids: new Set(), patterns: new Set() }),
    ...checkZoomFrom(scene, i, scopes[i - 1]),
    ...checkAnchors(scene, i, wordsByBeat.get(scene.beatId)),
  ]);
}

/** Element and pattern instance ids share one namespace per beat. */
function checkSceneIds(scene: BeatScene, i: number): SpecIssue[] {
  const ids = [...scene.elements.map((e) => e.id), ...scene.patterns.map((p) => p.id)];
  const elementCount = scene.elements.length;
  return findDuplicateIds(ids, (j) =>
    j < elementCount
      ? ['scenes', i, 'elements', j, 'id']
      : ['scenes', i, 'patterns', j - elementCount, 'id'],
  );
}

/**
 * A continuing beat keeps everything on its board: declaring an inherited id again would make two
 * things with one id. It acts on them with events instead.
 */
function checkInheritedIds(
  scene: BeatScene,
  i: number,
  inherited: TargetScope | undefined,
): SpecIssue[] {
  if (!inherited) return [];
  const declared = [
    ...scene.elements.map((e, j) => ({ id: e.id, path: ['scenes', i, 'elements', j, 'id'] })),
    ...scene.patterns.map((p, j) => ({ id: p.id, path: ['scenes', i, 'patterns', j, 'id'] })),
  ];
  return declared
    .filter((d) => inherited.ids.has(d.id))
    .map((d) => ({
      path: d.path,
      code: 'duplicate_id',
      message:
        `"${d.id}" is already on this board from an earlier beat. Act on it with events ` +
        'instead of declaring it again, or give the new thing its own id.',
    }));
}

function checkContinuation(scene: BeatScene, i: number): SpecIssue[] {
  if (i > 0 || !scene.continuesPrevious) return [];
  return [
    {
      path: ['scenes', 0, 'continuesPrevious'],
      code: 'continues_without_previous',
      message: 'The first beat has no previous beat to continue.',
    },
  ];
}

/**
 * `zoomFrom` names something on the previous beat's board, and only a `zoom-in` into a new board
 * can use it (a continuing beat keeps its board, so it has no transition).
 */
function checkZoomFrom(scene: BeatScene, i: number, previous: TargetScope | undefined) {
  if (scene.zoomFrom === undefined) return [];
  const path = ['scenes', i, 'zoomFrom'];
  const invalid = (message: string): SpecIssue[] => [{ path, code: 'invalid_zoom_from', message }];
  if (scene.transitionIn !== 'zoom-in') {
    return invalid('zoomFrom needs transitionIn "zoom-in".');
  }
  if (scene.continuesPrevious) {
    return invalid('A continuing beat keeps the previous board; it cannot zoom from it.');
  }
  if (!previous) return invalid('The first beat has no previous board to zoom from.');
  return targetIssues(path, scene.zoomFrom, previous);
}

/** Ids each scene may target, plus which of them are pattern instances. */
type TargetScope = { ids: Set<string>; patterns: Set<string> };

/** Ids each scene may target: its own, plus the previous scope when it continues the previous beat. */
function targetScopes(scenes: readonly BeatScene[]): TargetScope[] {
  const scopes: TargetScope[] = [];
  scenes.forEach((scene, i) => {
    const inherited = scene.continuesPrevious && i > 0 ? scopes[i - 1] : undefined;
    const patterns = scene.patterns.map((p) => p.id);
    scopes.push({
      ids: new Set([...(inherited?.ids ?? []), ...scene.elements.map((e) => e.id), ...patterns]),
      patterns: new Set([...(inherited?.patterns ?? []), ...patterns]),
    });
  });
  return scopes;
}

function checkTargets(scene: BeatScene, i: number, scope: TargetScope): SpecIssue[] {
  const events = scene.events.flatMap((event, e) =>
    event.targets.map((id, t) => ({ path: ['scenes', i, 'events', e, 'targets', t], id })),
  );
  const focus = scene.focus.map((id, f) => ({ path: ['scenes', i, 'focus', f], id }));
  return [...events, ...focus].flatMap(({ path, id }) => targetIssues(path, id, scope));
}

/**
 * A plain id must be in scope; `<instance>/<id>` needs a pattern instance in scope (the renderer
 * checks the inner id against the pattern's expansion).
 */
function targetIssues(path: SpecIssue['path'], id: string, scope: TargetScope): SpecIssue[] {
  const inner = splitInnerTarget(id);
  if (!inner) return scope.ids.has(id) ? [] : [unknownReference(path, 'element or pattern', id)];
  return scope.patterns.has(inner.instance)
    ? []
    : [unknownReference(path, 'pattern instance', inner.instance)];
}

/** Word anchors must land inside this beat's narration; skipped until the script exists. */
function checkAnchors(scene: BeatScene, i: number, words: string[] | undefined): SpecIssue[] {
  if (!words) return [];
  return scene.events.flatMap((event, e) => {
    const message = anchorProblem(event.at, words);
    return message
      ? [{ path: ['scenes', i, 'events', e, 'at'], code: 'anchor_out_of_range', message }]
      : [];
  });
}

/** Why a word anchor matches no word in `words`; undefined when it does (or is a beat anchor). */
export function anchorProblem(at: EventAnchor, words: readonly string[]): string | undefined {
  if (at.type === 'word' && at.index >= words.length) {
    return `Word index ${at.index} is past the end of the narration (${words.length} words).`;
  }
  if (at.type === 'word_text' && findWordOccurrence(words, at.text, at.occurrence) === undefined) {
    return `Occurrence ${at.occurrence} of "${at.text}" is not in this beat's narration.`;
  }
  return undefined;
}
