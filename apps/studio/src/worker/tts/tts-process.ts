import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';

/** How to start the server: a JSON-lines process (see `tts-python/kokoro_server.py`). */
export interface TtsSpawn {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
}

export type TtsProcessFailure = 'spawn' | 'startup' | 'exited' | 'timeout' | 'protocol';

/**
 * The process failed (could not start, died, hung or broke the protocol). `retryable` failures
 * may succeed in a fresh process; the client restarts once for those.
 */
export class TtsProcessError extends Error {
  override readonly name = 'TtsProcessError';
  constructor(
    readonly kind: TtsProcessFailure,
    message: string,
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.kind === 'exited' || this.kind === 'timeout' || this.kind === 'protocol';
  }
}

/** The server ran the request and reported an error (unknown voice, empty text). Not retried. */
export class TtsRequestError extends Error {
  override readonly name = 'TtsRequestError';
}

const ReadySchema = z.object({ type: z.literal('ready'), info: z.unknown() });
const FatalSchema = z.object({ type: z.literal('fatal'), error: z.string() });
const ResponseSchema = z.union([
  z.object({ id: z.number(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.number().nullable(), ok: z.literal(false), error: z.string() }),
]);

const STDERR_TAIL_LINES = 25;
const CLOSE_GRACE_MS = 2_000;

export interface RequestOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

/** Starts the server and resolves once it reports `ready`. */
export async function startTtsProcess(
  spec: TtsSpawn,
  options: { startupTimeoutMs: number },
): Promise<TtsProcess> {
  const server = new TtsProcess(spec);
  await server.waitReady(options.startupTimeoutMs);
  return server;
}

/** One running server. Requests are matched to responses by id. */
export class TtsProcess {
  /** The `info` the server sent with `ready`, unvalidated. */
  info: unknown;
  private readonly child: ChildProcess;
  private readonly stderrLines: string[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private exited = false;
  private failure: TtsProcessError | undefined;
  private onReady: ((error?: TtsProcessError) => void) | undefined;

  constructor(private readonly spec: TtsSpawn) {
    this.child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (this.child.stdout) {
      createInterface({ input: this.child.stdout }).on('line', (line) => this.onLine(line));
    }
    if (this.child.stderr) {
      createInterface({ input: this.child.stderr }).on('line', (line) => this.onStderr(line));
    }
    this.child.stdin?.on('error', () => undefined); // EPIPE after a crash; reported via 'exit'
    this.child.on('error', (error) => this.onSpawnError(error));
    this.child.on('exit', (code, signal) => this.onExit(code, signal));
  }

  get alive(): boolean {
    return !this.exited && !this.failure;
  }

  waitReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(
          new TtsProcessError(
            'startup',
            `TTS process not ready after ${timeoutMs} ms.${this.tail()}`,
          ),
        );
      }, timeoutMs);
      this.onReady = (error) => {
        clearTimeout(timer);
        this.onReady = undefined;
        if (error) reject(error);
        else resolve();
      };
    });
  }

  /** Sends one request; resolves with its `result`. */
  request(message: Record<string, unknown>, options: RequestOptions): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    options.signal?.throwIfAborted();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const { signal, timeoutMs } = options;
      const settle = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(id);
      };
      const onAbort = () => {
        settle();
        reject(signal?.reason instanceof Error ? signal.reason : new Error('TTS aborted'));
        // The engine cannot cancel mid-synthesis: kill it; the next call starts a new one.
        this.fail(new TtsProcessError('exited', 'TTS process killed after an abort.'));
      };
      const timer = setTimeout(() => {
        this.fail(new TtsProcessError('timeout', `TTS request timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (result) => (settle(), resolve(result)),
        reject: (error) => (settle(), reject(error)),
      });
      this.child.stdin?.write(`${JSON.stringify({ ...message, id })}\n`);
    });
  }

  /** Closes stdin (the server exits on EOF) and kills it after a grace period. */
  async close(): Promise<void> {
    if (this.exited) return;
    const exited = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
    this.child.stdin?.end();
    const timer = setTimeout(() => this.kill(), CLOSE_GRACE_MS);
    await exited;
    clearTimeout(timer);
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      this.fail(new TtsProcessError('protocol', `TTS process wrote a non-JSON line: ${line}`));
      return;
    }
    if (this.onReady) this.onHandshake(json, line);
    else this.onResponse(json, line);
  }

  private onHandshake(json: unknown, line: string): void {
    const ready = ReadySchema.safeParse(json);
    if (ready.success) {
      this.info = ready.data.info;
      this.onReady?.();
      return;
    }
    const fatal = FatalSchema.safeParse(json);
    const reason = fatal.success ? fatal.data.error : `unexpected first line: ${line}`;
    this.fail(new TtsProcessError('startup', `TTS process failed to start: ${reason}`));
  }

  private onResponse(json: unknown, line: string): void {
    const response = ResponseSchema.safeParse(json);
    const id = response.success ? response.data.id : null;
    const entry = id === null ? undefined : this.pending.get(id);
    if (!response.success || !entry) {
      this.fail(new TtsProcessError('protocol', `TTS process sent an unexpected message: ${line}`));
      return;
    }
    if (response.data.ok) entry.resolve(response.data.result);
    else entry.reject(new TtsRequestError(response.data.error));
  }

  private onStderr(line: string): void {
    this.stderrLines.push(line);
    if (this.stderrLines.length > STDERR_TAIL_LINES) this.stderrLines.shift();
  }

  private onSpawnError(error: Error): void {
    this.exited = true;
    this.fail(
      new TtsProcessError(
        'spawn',
        `Could not start the TTS process (${this.spec.command}): ${error.message}. ` +
          'Run `pnpm tts:setup`.',
      ),
    );
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exited = true;
    const how = signal ? `signal ${signal}` : `code ${code}`;
    const kind = this.onReady ? 'startup' : 'exited';
    // Let stderr deliver its last lines before the message is built.
    setImmediate(() => this.fail(new TtsProcessError(kind, `TTS process exited (${how}).`)));
  }

  /** Records the first failure, kills the process and rejects everything waiting on it. */
  private fail(error: TtsProcessError): void {
    if (!this.failure) {
      this.failure = new TtsProcessError(error.kind, `${error.message}${this.tail()}`);
    }
    this.kill();
    this.onReady?.(this.failure);
    for (const entry of this.pending.values()) entry.reject(this.failure);
    this.pending.clear();
  }

  private kill(): void {
    if (!this.exited) this.child.kill('SIGKILL');
  }

  private tail(): string {
    if (!this.stderrLines.length) return '';
    return `\n--- TTS stderr (last lines) ---\n${this.stderrLines.join('\n')}`;
  }
}
