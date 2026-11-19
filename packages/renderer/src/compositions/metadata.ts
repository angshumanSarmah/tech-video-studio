import {
  effectiveTiming,
  ResolvedAssetSchema,
  validateRenderableVideoSpec,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import type { CalculateMetadataFunction } from 'remotion';
import { z } from 'zod';
import { getTheme } from '../theme/index.ts';
import { beatFrameSpans, totalFrames, type BeatFrameSpan } from '../timing/frames.ts';
import type { BeatFromSpecProps, VideoFromSpecProps } from './props.ts';

/** Validates a spec for rendering; throws with every structured error (JSON path + code). */
export function parseRenderableSpec(input: unknown): RenderableVideoSpec {
  const result = validateRenderableVideoSpec(input);
  if (result.ok) return result.spec;
  const lines = result.errors.map((e) => `  ${e.path} [${e.code}] ${e.message}`);
  throw new Error(`Invalid VideoSpec:\n${lines.join('\n')}`);
}

function assertFps(fps: number): void {
  if (!Number.isInteger(fps) || fps <= 0) {
    throw new Error(`fps must be a positive integer, got ${fps}.`);
  }
}

/** The frame span of one beat; throws when the spec has no such beat. */
export function findBeatSpan(
  spec: RenderableVideoSpec,
  beatId: string,
  fps: number,
): BeatFrameSpan {
  const spans = beatFrameSpans(effectiveTiming(spec), fps);
  const span = spans.find((s) => s.beatId === beatId);
  if (span) return span;
  const known = spans.map((s) => s.beatId).join(', ');
  throw new Error(`Unknown beat "${beatId}". Beats in this spec: ${known}.`);
}

/** Validates the `assets` prop; throws with each issue's path. Omitted stays omitted. */
export function parseRenderAssets(input: unknown): VideoFromSpecProps['assets'] {
  if (input === undefined) return undefined;
  const parsed = z.array(ResolvedAssetSchema).safeParse(input);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((i) => `  assets.${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid assets:\n${lines.join('\n')}`);
}

/** Validated spec and assets, as `calculateMetadata` hands them to the composition. */
function parsedProps<P extends VideoFromSpecProps>(props: P): P & { spec: RenderableVideoSpec } {
  const spec = parseRenderableSpec(props.spec);
  const assets = parseRenderAssets(props.assets);
  return { ...props, spec, ...(assets ? { assets } : {}) };
}

/** Canvas size of the props' theme; throws on an unknown theme id (listing the known ones). */
function themeCanvas(props: VideoFromSpecProps): { width: number; height: number } {
  const { width, height } = getTheme(props.themeId).canvas;
  return { width, height };
}

/** Whole video: duration from `spec.timing`, or estimated from word counts before TTS. */
export function videoMetadata(props: VideoFromSpecProps) {
  assertFps(props.fps);
  const parsed = parsedProps(props);
  return {
    ...themeCanvas(props),
    fps: props.fps,
    durationInFrames: totalFrames(effectiveTiming(parsed.spec), props.fps),
    props: parsed,
  };
}

/** One beat: duration is the beat's span, as it is cut from the whole video. */
export function beatMetadata(props: BeatFromSpecProps) {
  assertFps(props.fps);
  const parsed = parsedProps(props);
  const span = findBeatSpan(parsed.spec, props.beatId, props.fps);
  return {
    ...themeCanvas(props),
    fps: props.fps,
    durationInFrames: span.durationInFrames,
    props: parsed,
  };
}

export const calculateVideoMetadata: CalculateMetadataFunction<VideoFromSpecProps> = ({ props }) =>
  videoMetadata(props);

export const calculateBeatMetadata: CalculateMetadataFunction<BeatFromSpecProps> = ({ props }) =>
  beatMetadata(props);
