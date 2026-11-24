import type { BeatScene, VideoSpec } from '@explainer-studio/shared';

/**
 * The Generator's run order (P1C.7), pure. A beat waits for the beat before it when it continues
 * that board (`continuesPrevious`) or zooms into it (`semantic_zoom`); every other beat starts a
 * chain of its own, and chains run in parallel (the LLM client caps how many calls are in
 * flight). A beat sees only the boards it depends on, so its input is the same whatever order
 * parallel chains finish in.
 */

/** The beat this beat waits for, or undefined when it starts a chain. */
export function beatDependency(spec: VideoSpec, index: number): number | undefined {
  const beat = spec.story.beats[index];
  if (!beat || index === 0) return undefined;
  return beat.continuesPrevious || beat.device === 'semantic_zoom' ? index - 1 : undefined;
}

/** Every beat this beat depends on, directly or not, oldest first. */
export function beatAncestors(spec: VideoSpec, index: number): number[] {
  const out: number[] = [];
  for (let k = beatDependency(spec, index); k !== undefined; k = beatDependency(spec, k)) {
    out.unshift(k);
  }
  return out;
}

/** The later beats that depend on this one, directly or not, in order. */
export function beatDependents(spec: VideoSpec, index: number): number[] {
  const out: number[] = [];
  for (let j = index + 1; beatDependency(spec, j) === j - 1; j += 1) out.push(j);
  return out;
}

/** The scenes a beat may see: its ancestors' boards; every other beat is not drawn yet. */
export function visibleScenes(
  spec: VideoSpec,
  index: number,
  scenes: readonly (BeatScene | undefined)[],
): (BeatScene | undefined)[] {
  const seen = new Set(beatAncestors(spec, index));
  return spec.story.beats.map((_, k) => (seen.has(k) ? scenes[k] : undefined));
}

/**
 * The cache warm-up: the first call of a job runs alone; every later call waits until it has
 * finished (failed or not), so the provider has the shared prompt prefix cached before calls fan
 * out. Calls never made (reused beats) do not count.
 */
export function createWarmUp(): <T>(call: () => Promise<T>) => Promise<T> {
  let first: Promise<unknown> | undefined;
  return async (call) => {
    if (!first) {
      const running = call();
      first = running.catch(() => undefined);
      return running;
    }
    await first;
    return call();
  };
}
