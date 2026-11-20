import { makeCancelSignal, RenderInternals } from '@remotion/renderer';

/**
 * The only place that runs ffmpeg / ffprobe. It uses the binaries Remotion ships with
 * `@remotion/renderer` (no system ffmpeg needed), through `RenderInternals.callFf`, which is
 * internal API: the exact pinned Remotion version keeps it stable, and if an upgrade breaks it,
 * only this file changes. `bench:render` checks `ffmpeg -version` through here first.
 */

export type FfBinary = 'ffmpeg' | 'ffprobe';

export class FfmpegError extends Error {
  override readonly name = 'FfmpegError';
}

/** Runs ffmpeg or ffprobe and resolves with stdout; rejects with stderr. Aborts with `signal`. */
export async function runFf(
  bin: FfBinary,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  const { cancelSignal, cancel } = makeCancelSignal();
  const onAbort = () => cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    const result = await RenderInternals.callFf({
      bin,
      args: [...args],
      indent: false,
      logLevel: 'error',
      binariesDirectory: null,
      cancelSignal,
    });
    return result.stdout;
  } catch (error) {
    signal?.throwIfAborted();
    throw new FfmpegError(`${bin} ${args.join(' ')} failed: ${describe(error)}`, { cause: error });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export function runFfmpeg(args: readonly string[], signal?: AbortSignal): Promise<string> {
  return runFf('ffmpeg', args, signal);
}

/** First line of `ffmpeg -version`; throws `FfmpegError` when the adapter is broken. */
export async function ffmpegVersion(): Promise<string> {
  const out = await runFf('ffmpeg', ['-hide_banner', '-version']);
  const line = out.split('\n')[0]?.trim();
  if (!line?.startsWith('ffmpeg version')) {
    throw new FfmpegError(`Unexpected ffmpeg -version output: ${out.slice(0, 200)}`);
  }
  return line;
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string') {
    return error.stderr.trim() || message;
  }
  return message;
}
