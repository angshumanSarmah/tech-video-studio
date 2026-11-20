import type { RenderPreset } from '@explainer-studio/shared';
import type { RenderMode } from './encoding.ts';

/**
 * What the render functions need from Remotion, as a port: `remotion-engine.ts` implements it,
 * tests use a fake. Every video it writes is silent; narration is muxed with ffmpeg afterwards.
 */

export type CompositionId = 'VideoFromSpec' | 'BeatFromSpec';

export interface VideoRequest {
  readonly compositionId: CompositionId;
  /** `VideoFromSpecProps` / `BeatFromSpecProps` as plain JSON (`fps` from the preset). */
  readonly inputProps: Record<string, unknown>;
  readonly preset: RenderPreset;
  readonly mode: RenderMode;
  readonly concurrency: number;
  readonly outPath: string;
  readonly signal: AbortSignal;
  /** 0..1 of this video's frames rendered and encoded. */
  readonly onProgress: (fraction: number) => void;
}

export interface StillRequest {
  readonly compositionId: CompositionId;
  readonly inputProps: Record<string, unknown>;
  readonly preset: RenderPreset;
  /** Frame of the composition (a `BeatFromSpec` frame counts from the beat's start). */
  readonly frame: number;
  readonly outPath: string;
  readonly signal: AbortSignal;
}

/** One browser for a batch of renders (a job); close it when the batch ends. */
export interface RenderSession {
  /** Renders a silent H.264 yuv420p MP4; resolves with its frame count. */
  renderVideo(request: VideoRequest): Promise<{ frames: number }>;
  renderStill(request: StillRequest): Promise<void>;
  close(): Promise<void>;
}

export interface RenderEngine {
  /** Identity of what renders draw (`rendererSourceHash`); part of draft cache keys. */
  identity(): Promise<string>;
  open(): Promise<RenderSession>;
}

/** Runs `fn` with a session and always closes it. */
export async function withSession<T>(
  engine: RenderEngine,
  fn: (session: RenderSession) => Promise<T>,
): Promise<T> {
  const session = await engine.open();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}
