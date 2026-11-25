import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { loadConfig, readSettings } from '#core/config.ts';
import { ensureDataDirs } from '#core/data-dirs.ts';
import { closeDatabase, dbPathFor, openDatabase } from '#core/db/client.ts';
import { runCli } from './cli.ts';
import { EXIT, type CliIo } from './context.ts';

/**
 * `pnpm studio …` (P1C.9b). The `studio` script runs `db:migrate` first, as `dev` does, so this
 * process never migrates. Ctrl-C stops the worker it runs (the running job is requeued) and
 * leaves the run where it is.
 */

const config = loadConfig();
ensureDataDirs(config.dataDir);
const db = openDatabase(dbPathFor(config.dataDir));
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const controller = new AbortController();
let liveShown = false;

const clearLive = () => {
  if (liveShown) process.stderr.write('\r\x1b[2K');
  liveShown = false;
};

const io: CliIo = {
  out: (line) => {
    clearLive();
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    clearLive();
    process.stderr.write(`${line}\n`);
  },
  live: (line) => {
    if (!process.stderr.isTTY) return;
    process.stderr.write(`\r\x1b[2K${line.slice(0, (process.stderr.columns || 100) - 1)}`);
    liveShown = true;
  },
  isTTY: interactive,
  ask: async (question) => {
    clearLive();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(question, { signal: controller.signal });
    } catch {
      return null;
    } finally {
      rl.close();
    }
  },
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  },
  edit: (path) => {
    const editor = process.env['VISUAL'] ?? process.env['EDITOR'] ?? 'vi';
    // The editor may carry its own flags (`code -w`), so the shell splits it; the path is quoted.
    spawnSync(`${editor} ${JSON.stringify(path)}`, { stdio: 'inherit', shell: true });
    return Promise.resolve();
  },
  cwd: process.env['INIT_CWD'] ?? process.cwd(),
};

/** Ctrl-C: the command stops following and its worker stops (a second Ctrl-C exits at once). */
const interrupt = () => {
  if (controller.signal.aborted) process.exit(EXIT.interrupted);
  io.err('\nStopping (the running job is requeued; the run stays where it is) …');
  controller.abort();
  setTimeout(() => process.exit(EXIT.interrupted), 30_000).unref();
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

const code = await runCli(process.argv.slice(2), {
  config,
  db,
  io,
  appSettings: () => readSettings(config.settingsPath),
  signal: controller.signal,
});
closeDatabase(db);
process.exit(code);
