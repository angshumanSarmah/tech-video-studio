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
    ...checkContinuation(scene, i),
    ...checkTargets(scene, i, scopes[i] ?? new Set()),
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

/** Ids each scene may target: its own, plus the previous scope when it continues the previous beat. */
function targetScopes(scenes: readonly BeatScene[]): Set<string>[] {
  const scopes: Set<string>[] = [];
  scenes.forEach((scene, i) => {
    const inherited = scene.continuesPrevious && i > 0 ? (scopes[i - 1] ?? []) : [];
    scopes.push(
      new Set([
        ...inherited,
        ...scene.elements.map((e) => e.id),
        ...scene.patterns.map((p) => p.id),
      ]),
    );
  });
  return scopes;
}

function checkTargets(scene: BeatScene, i: number, scope: Set<string>): SpecIssue[] {
  const refs: [SpecIssue['path'], string][] = [
    ...scene.events.flatMap((event, e) =>
      event.targets.map((id, t): [SpecIssue['path'], string] => [
        ['scenes', i, 'events', e, 'targets', t],
        id,
      ]),
    ),
    ...scene.focus.map((id, f): [SpecIssue['path'], string] => [['scenes', i, 'focus', f], id]),
  ];
  return refs.flatMap(([path, id]) =>
    scope.has(id) ? [] : [unknownReference(path, 'element or pattern', id)],
  );
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
