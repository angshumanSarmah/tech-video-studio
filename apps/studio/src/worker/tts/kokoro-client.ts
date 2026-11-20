import { z } from 'zod';
import { startTtsProcess, TtsProcessError, type TtsProcess, type TtsSpawn } from './tts-process.ts';

/** What the server reports with `ready` (validated at the process boundary). */
export const KokoroInfoSchema = z.object({
  python: z.string(),
  packages: z.record(z.string(), z.string()),
  revision: z.string(),
  files: z.record(z.string(), z.string()),
  espeakLibrary: z.string(),
  sampleRate: z.number(),
  device: z.string(),
});
export type KokoroInfo = z.infer<typeof KokoroInfoSchema>;

export const EngineTokenSchema = z.object({
  text: z.string(),
  whitespace: z.string(),
  phonemes: z.string(),
  startSec: z.number().nullable(),
  endSec: z.number().nullable(),
});

export const SynthesisSchema = z.object({
  tokens: z.array(EngineTokenSchema),
  durationSec: z.number().positive(),
  sampleRate: z.number(),
  /** Wall-clock seconds the server spent synthesising (for the real-time factor). */
  synthSec: z.number(),
});
export type Synthesis = z.infer<typeof SynthesisSchema>;

export interface SynthesizeRequest {
  readonly text: string;
  readonly voice: string;
  readonly speed: number;
  /** Absolute path the server writes the WAV to. */
  readonly outPath: string;
}

export interface KokoroClientOptions {
  readonly spawn: TtsSpawn;
  /** Model load included; the first start after setup also warms Python's bytecode cache. */
  readonly startupTimeoutMs?: number;
  /** Per-request timeout, from the text length. */
  readonly requestTimeoutMs?: (text: string) => number;
  readonly log?: (message: string) => void;
}

export interface KokoroClient {
  /** Starts the server if needed and returns its `ready` info. */
  info(signal?: AbortSignal): Promise<KokoroInfo>;
  synthesize(request: SynthesizeRequest, signal?: AbortSignal): Promise<Synthesis>;
  close(): Promise<void>;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
/** Synthesis runs ~10x faster than real time on CPU; this allows a slow machine 10x headroom. */
export const defaultRequestTimeoutMs = (text: string): number => 30_000 + text.length * 50;

/**
 * Starts the Kokoro server once and reuses it. Calls are serialised (the server is
 * single-threaded). When the process dies, hangs or breaks the protocol, the client restarts it
 * once and retries the call; a second failure is thrown. Errors the server reports for a request
 * (unknown voice) and aborts are never retried.
 */
export function createKokoroClient(options: KokoroClientOptions): KokoroClient {
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs;
  let server: Promise<TtsProcess> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const current = (): Promise<TtsProcess> => {
    server ??= startTtsProcess(options.spawn, { startupTimeoutMs });
    // A failed start must not be reused by the next call.
    server.catch(() => undefined);
    return server;
  };

  const discard = async (failed: Promise<TtsProcess> | undefined) => {
    if (server === failed) server = undefined;
    await failed?.then((p) => p.close()).catch(() => undefined);
  };

  /** Runs `call` on a live server; on a retryable failure restarts once and runs it again. */
  async function withRestart<T>(
    call: (p: TtsProcess) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const attempt = async () => {
      const started = current();
      try {
        const live = await started;
        if (!live.alive) throw new TtsProcessError('exited', 'TTS process is not running.');
        return await call(live);
      } catch (error) {
        // Keep a healthy server after a request error; replace a dead or failed one.
        const live = await started.catch(() => undefined);
        if (!live?.alive) await discard(started);
        throw error;
      }
    };
    try {
      return await attempt();
    } catch (first) {
      if (signal?.aborted || !(first instanceof TtsProcessError) || !first.retryable) throw first;
      options.log?.(`TTS process failed (${first.kind}); restarting once. ${first.message}`);
      try {
        return await attempt();
      } catch (second) {
        if (!(second instanceof TtsProcessError)) throw second;
        throw new TtsProcessError(
          second.kind,
          `TTS process failed again after one restart: ${second.message}\n` +
            `(first failure: ${first.message})`,
        );
      }
    }
  }

  function serialised<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  return {
    info: (signal) =>
      serialised(() =>
        withRestart(
          (p) => Promise.resolve(p.info).then((info) => KokoroInfoSchema.parse(info)),
          signal,
        ),
      ),
    synthesize: (request, signal) =>
      serialised(() =>
        withRestart(async (p) => {
          const result = await p.request(
            { op: 'synthesize', ...request },
            { timeoutMs: requestTimeoutMs(request.text), signal },
          );
          return SynthesisSchema.parse(result);
        }, signal),
      ),
    close: () => serialised(() => discard(server)),
  };
}
