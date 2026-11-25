import type { RunSettingsSource } from '@explainer-studio/shared';
import type { AppConfig } from '#core/config.ts';
import type { Db } from '#core/db/client.ts';
import type { WorkerParts } from '#worker/runtime.ts';

/** What every CLI command works with: config, the database and the terminal. */
export interface CliContext {
  readonly config: AppConfig;
  readonly db: Db;
  readonly io: CliIo;
  /** The app settings as they are now (`settings.json`, read on each run start). */
  readonly appSettings: () => RunSettingsSource;
  /** Tests replace what the CLI's worker would build (renderer, TTS, LLM transport). */
  readonly workerParts?: Partial<WorkerParts>;
  /** How often a followed run is read again (default 250 ms). */
  readonly pollMs?: number;
  /** Ctrl-C: stop following (the run stays where it is). */
  readonly signal?: AbortSignal;
}

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  /** Replaces the live progress line; a no-op without a terminal. */
  live(line: string): void;
  /** A terminal on both sides: gates ask what to do, progress is drawn on one line. */
  readonly isTTY: boolean;
  /** One line typed by the user; null at end of input. */
  ask(question: string): Promise<string | null>;
  readStdin(): Promise<string>;
  /** Opens `$EDITOR` (or `vi`) on a file and waits for it to close. */
  edit(path: string): Promise<void>;
  /** Where relative paths are resolved from (`INIT_CWD` under pnpm). */
  readonly cwd: string;
}

/** A command that cannot go on, with what to do; printed without a stack. */
export class CliError extends Error {
  override readonly name = 'CliError';
}

/** Exit codes: 0 done or waiting at a gate, 1 failed / cancelled / paused / error, 2 usage. */
export const EXIT = { ok: 0, failed: 1, usage: 2, interrupted: 130 } as const;
