import { join } from 'node:path';
import { readPronunciations } from '#core/pronunciations.ts';
import { createKokoroClient, type KokoroClient } from './kokoro-client.ts';
import { createKokoroProvider } from './kokoro-provider.ts';
import { readModelIdentity, type ModelIdentity } from './model-identity.ts';
import type { TtsProvider } from './provider.ts';
import type { TtsSpawn } from './tts-process.ts';

/** Where the Kokoro env lives, relative to the workspace root. */
export const TTS_PYTHON_DIR = 'apps/studio/tts-python';

export interface KokoroPaths {
  readonly dir: string;
  readonly python: string;
  readonly server: string;
  readonly modelsLock: string;
  readonly uvLock: string;
}

/** `python` is `settings.tts.binaryPath` (already absolute in `AppConfig`). */
export function kokoroPaths(workspaceRoot: string, python: string): KokoroPaths {
  const dir = join(workspaceRoot, TTS_PYTHON_DIR);
  return {
    dir,
    python,
    server: join(dir, 'kokoro_server.py'),
    modelsLock: join(dir, 'models.lock.json'),
    uvLock: join(dir, 'uv.lock'),
  };
}

export function kokoroSpawn(paths: KokoroPaths): TtsSpawn {
  return {
    command: paths.python,
    args: [paths.server],
    cwd: paths.dir,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  };
}

export interface KokoroTts {
  readonly provider: TtsProvider;
  readonly client: KokoroClient;
  readonly identity: ModelIdentity;
}

/** The default TTS provider, wired from app config. Nothing starts until the first cache miss. */
export function createKokoroTts(options: {
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly python: string;
  readonly log?: (message: string) => void;
}): KokoroTts {
  const paths = kokoroPaths(options.workspaceRoot, options.python);
  const identity = readModelIdentity(paths);
  const client = createKokoroClient({ spawn: kokoroSpawn(paths), log: options.log });
  const provider = createKokoroProvider({
    dataDir: options.dataDir,
    client,
    identity,
    pronunciations: () => readPronunciations(options.dataDir),
  });
  return { provider, client, identity };
}
