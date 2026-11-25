import type { RenderableVideoSpec, VideoSpec } from './shape.ts';

/**
 * A spec as the renderer's text checks need it before scenes exist: its own script (or one
 * placeholder narration word per beat) and an empty board per beat, timed by estimate. Enough
 * for the HUD, subtitle and source-footnote checks, which read the title, chapters, headlines,
 * narration and sources, never the boards.
 */
export function previewSpec(spec: VideoSpec): RenderableVideoSpec {
  const beats = spec.story.beats;
  return {
    ...spec,
    script:
      spec.script ??
      beats.map((b) => ({ beatId: b.id, narration: 'placeholder', tags: [], statCards: [] })),
    scenes: beats.map((b) => ({
      beatId: b.id,
      kind: 'board',
      elements: [],
      patterns: [],
      events: [],
      focus: [],
      transitionIn: 'cut',
      continuesPrevious: false,
    })),
  };
}
