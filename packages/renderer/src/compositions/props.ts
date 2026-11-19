import type { RenderableVideoSpec } from '@explainer-studio/shared';

/** Series label and accent are data (DB `series`); the render service passes them in. */
export type SeriesProps = {
  label: string;
  /** Hex colour; missing or invalid falls back to the theme accent (`resolveAccent`). */
  accentColour: string | null;
};

/**
 * Props are plain JSON: Remotion's `schema` prop is not used because it targets Zod 3 and
 * `packages/shared` uses Zod 4. `calculateMetadata` validates the spec instead.
 */
export type VideoFromSpecProps = {
  spec: RenderableVideoSpec;
  series: SeriesProps;
  /**
   * Narration track as an http(s) URL or `staticFile()` path: Remotion renders in a browser, so a
   * filesystem path will not load. Null renders without sound (preview before TTS).
   */
  audioSrc: string | null;
  /** Channel handle for the top bar (DB `channels.handle`); null hides it. */
  channelHandle: string | null;
  /** Frame rate of the preset: 30 final, 15 draft. */
  fps: number;
  /** Theme registry id; omitted renders the default theme. Unknown ids fail in `calculateMetadata`. */
  themeId?: string;
};

export type BeatFromSpecProps = VideoFromSpecProps & { beatId: string };
