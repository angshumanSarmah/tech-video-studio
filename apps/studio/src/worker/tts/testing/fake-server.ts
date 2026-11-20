import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TtsSpawn } from '../tts-process.ts';

export type FakeMode = 'ok' | 'crash-once' | 'crash-always' | 'hang' | 'fatal' | 'garbage';

export interface FakeServer {
  readonly spawn: TtsSpawn;
  /** How many times the fake process has started. */
  starts(): number;
}

const SCRIPT = join(import.meta.dirname, 'fake-tts-server.ts');

/** Spawn options for `fake-tts-server.ts` with its own state directory. */
export function fakeServer(mode: FakeMode, info: object = {}): FakeServer {
  const state = mkdtempSync(join(tmpdir(), 'fake-tts-'));
  const startsFile = join(state, 'starts');
  return {
    spawn: {
      command: process.execPath,
      args: [SCRIPT],
      cwd: state,
      env: {
        ...process.env,
        FAKE_TTS_MODE: mode,
        FAKE_TTS_STATE: state,
        FAKE_TTS_INFO: JSON.stringify(info),
      },
    },
    starts: () =>
      existsSync(startsFile) ? readFileSync(startsFile, 'utf8').trim().split('\n').length : 0,
  };
}
