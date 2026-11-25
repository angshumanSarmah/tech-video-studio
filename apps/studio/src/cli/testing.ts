import { join } from 'node:path';
import { SettingsSchema } from '@explainer-studio/shared';
import { testConfig } from '#core/config-testing.ts';
import type { TestDb } from '#core/db/testing.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { fixtureTts } from '#worker/repair/testing.ts';
import { fakeTools } from '#worker/render/testing.ts';
import type { FixtureTopicId } from '#worker/agents/fixture-topics.ts';
import type { CliContext, CliIo } from './context.ts';

/** Test-only helpers for the CLI. Not imported by any entrypoint. */

export { testConfig };

export interface FakeIo extends CliIo {
  readonly lines: string[];
  readonly errors: string[];
  /** Everything printed, stdout and stderr, in order. */
  readonly transcript: string[];
}

/** A terminal that records what is printed; with `answers`, a TTY that types them in order. */
export function fakeIo(answers?: readonly string[], stdin = ''): FakeIo {
  const lines: string[] = [];
  const errors: string[] = [];
  const transcript: string[] = [];
  const queue = [...(answers ?? [])];
  return {
    lines,
    errors,
    transcript,
    out: (line) => {
      lines.push(line);
      transcript.push(line);
    },
    err: (line) => {
      errors.push(line);
      transcript.push(line);
    },
    live: () => undefined,
    isTTY: answers !== undefined,
    ask: (question) => {
      transcript.push(question);
      return Promise.resolve(queue.shift() ?? null);
    },
    readStdin: () => Promise.resolve(stdin),
    edit: () => Promise.resolve(),
    cwd: findWorkspaceRoot(import.meta.dirname),
  };
}

/** A CLI context over a test DB with a fake renderer and the topic's committed Kokoro timing. */
export function cliContext(t: TestDb, io: CliIo, topic: FixtureTopicId): CliContext {
  return {
    config: testConfig(t.dataDir),
    db: t.db,
    io,
    appSettings: () => SettingsSchema.parse({}),
    workerParts: {
      tools: fakeTools().tools,
      tts: fixtureTts(topic, join(t.dataDir, 'fake-tts')).provider,
    },
    pollMs: 10,
  };
}
