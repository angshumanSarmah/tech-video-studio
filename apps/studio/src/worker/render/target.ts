import { renameSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SeriesProps, VideoFromSpecProps } from '@explainer-studio/renderer/catalog';
import type {
  RenderableVideoSpec,
  RenderPreset,
  RenderSettings,
  ResolvedAsset,
} from '@explainer-studio/shared';
import type { SpecSource } from '#core/render-manifests.ts';
import type { RenderEngine } from './engine.ts';

/**
 * What one render works from, independent of the DB (the job handlers build it from a run, the
 * benchmark from a fixture).
 */
export interface RenderTarget {
  readonly spec: RenderableVideoSpec;
  readonly props: {
    readonly series: SeriesProps;
    readonly channelHandle: string | null;
    readonly themeId?: string;
    readonly assets?: ResolvedAsset[];
  };
  /** Absolute path of the narration WAV (0 s = frame 0), or null to render silently. */
  readonly audioPath: string | null;
  /**
   * The spec version this target was loaded from, recorded in every output's sidecar. Not part
   * of draft cache keys: a clip whose inputs did not change is reused across versions and keeps
   * the version it was made from. Omitted outside runs (the benchmark's fixture).
   */
  readonly source?: SpecSource;
}

export { SpecSourceSchema, type SpecSource } from '#core/render-manifests.ts';

/** How renders run: Remotion, ffmpeg and the configured presets and concurrency. */
export interface RenderTools {
  readonly engine: RenderEngine;
  readonly ffmpeg: (args: readonly string[], signal?: AbortSignal) => Promise<string>;
  readonly settings: RenderSettings;
}

/** One job's cancellation and progress (0..1 of the whole job). */
export interface RenderRun {
  readonly signal: AbortSignal;
  readonly onProgress: (fraction: number, message?: string) => void;
}

/** Composition props as plain JSON. Audio is never played by Remotion: it is muxed afterwards. */
export function compositionProps(
  target: RenderTarget,
  preset: RenderPreset,
  extra: { beatId?: string; draft?: boolean } = {},
): Record<string, unknown> {
  const props: VideoFromSpecProps & { beatId?: string } = {
    ...target.props,
    spec: target.spec,
    audioSrc: null,
    fps: preset.fps,
    ...extra,
  };
  return props;
}

/** `<path>` with `.<tag>` before its extension: `a/b.mp4` → `a/b.<tag>.mp4`. */
export function siblingPath(path: string, tag: string): string {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/')
    ? `${path.slice(0, dot)}.${tag}${path.slice(dot)}`
    : `${path}.${tag}`;
}

/**
 * Writes `path` atomically: `write` gets a partial path next to it, which is renamed into place
 * once it resolves. On failure the partial file is removed and `path` is left as it was.
 */
export async function writeAtomically(
  path: string,
  write: (partialPath: string) => Promise<void>,
): Promise<void> {
  const partial = siblingPath(path, 'partial');
  await mkdir(dirname(path), { recursive: true });
  try {
    await write(partial);
    renameSync(partial, path);
  } finally {
    rmSync(partial, { force: true });
  }
}
