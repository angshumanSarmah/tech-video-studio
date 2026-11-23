import type {
  BeatScene,
  RenderableVideoSpec,
  StoryBeat,
  VideoSpec,
} from '@explainer-studio/shared';

/**
 * The run's spec as the Generator sees it while it works beat by beat: the boards generated so
 * far, an empty placeholder for every beat not generated yet. The check and the user message both
 * read it. Pure.
 */

export interface GeneratorBoards {
  /** The run's spec: plan and script, with timing when TTS has run (its scenes are ignored). */
  readonly spec: VideoSpec;
  /** Scenes generated so far, by story beat index; undefined for beats not generated yet. */
  readonly scenes: readonly (BeatScene | undefined)[];
}

/** The spec with `scene` at beat `index` (when given), generated scenes and placeholders. */
export function spliceBoards(
  boards: GeneratorBoards,
  index?: number,
  scene?: BeatScene,
): RenderableVideoSpec {
  const { spec } = boards;
  if (!spec.script) throw new Error('The Generator needs the script.');
  const scenes = spec.story.beats.map((beat, k) =>
    k === index && scene ? scene : (boards.scenes[k] ?? placeholderScene(beat)),
  );
  return { ...spec, script: spec.script, scenes };
}

/** An empty board for a beat not generated yet. */
export function placeholderScene(beat: StoryBeat): BeatScene {
  return {
    beatId: beat.id,
    kind: 'board',
    elements: [],
    patterns: [],
    events: [],
    focus: [],
    transitionIn: 'cut',
    continuesPrevious: beat.continuesPrevious,
  };
}

/** Index of the first beat of the board beat `index` is on (the plan's `continuesPrevious`). */
export function boardStart(spec: VideoSpec, index: number): number {
  let first = index;
  while (first > 0 && spec.story.beats[first]?.continuesPrevious) first -= 1;
  return first;
}
