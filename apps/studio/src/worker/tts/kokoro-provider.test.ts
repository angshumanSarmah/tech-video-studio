import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pronunciations } from '@explainer-studio/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createKokoroClient } from './kokoro-client.ts';
import { createKokoroProvider } from './kokoro-provider.ts';
import type { TtsProvider } from './provider.ts';
import { TtsWordError } from './provider.ts';
import { fakeServer, type FakeMode } from './testing/fake-server.ts';

const identity = {
  packages: { kokoro: '0.9.4' },
  revision: 'rev1',
  files: { 'kokoro-v1_0.pth': 'w1', 'voices/af_heart.pt': 'v1', 'voices/bf_emma.pt': 'v2' },
};

let provider: TtsProvider | undefined;
afterEach(async () => {
  await provider?.close();
  provider = undefined;
});

function setup(options: { mode?: FakeMode; reported?: object; dictionary?: Pronunciations } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'kokoro-provider-'));
  const server = fakeServer(options.mode ?? 'ok', options.reported ?? identity);
  let dictionary = options.dictionary ?? {};
  provider = createKokoroProvider({
    dataDir,
    client: createKokoroClient({ spawn: server.spawn, startupTimeoutMs: 10_000 }),
    identity,
    pronunciations: () => dictionary,
  });
  return {
    provider,
    server,
    dataDir,
    setDictionary: (next: Pronunciations) => (dictionary = next),
  };
}

const cacheEntries = (dataDir: string) => readdirSync(join(dataDir, 'tts', 'cache')).sort();

describe('createKokoroProvider', () => {
  it('maps word timings back to the original words through the dictionary', async () => {
    const { provider } = setup({ dictionary: { UPI: 'U P I' } });
    const result = await provider.synthesize('UPI pays, fast.', 'af_heart', 1);
    // The fake speaks one token per spoken word, 0.3 s apart: U, P, I, pays,, fast.
    expect(result.words).toEqual([
      { text: 'upi', startSec: 0, endSec: 0.85 },
      { text: 'pays', startSec: 0.9, endSec: 1.15 },
      { text: 'fast', startSec: 1.2, endSec: 1.45 },
    ]);
    expect(result.cached).toBe(false);
    expect(readFileSync(result.wavPath).subarray(0, 4).toString()).toBe('RIFF');
  });

  it('serves the second call from the cache without starting the engine', async () => {
    const { dataDir } = setup();
    const first = await createAndSynthesize(dataDir, 'one two three');
    const second = await createAndSynthesize(dataDir, 'one two three');
    expect(first.result.cached).toBe(false);
    expect(second.result).toEqual({ ...first.result, cached: true });
    expect(second.starts).toBe(0);
    expect(cacheEntries(dataDir)).toHaveLength(2);
  });

  it('keys the cache by text, voice, speed and the dictionary', async () => {
    const { provider, dataDir, setDictionary } = setup();
    await provider.synthesize('Redis works', 'af_heart', 1);
    await provider.synthesize('Redis works', 'af_heart', 1.2);
    await provider.synthesize('Redis works', 'bf_emma', 1);
    setDictionary({ Redis: 'reddis' });
    await provider.synthesize('Redis works', 'af_heart', 1);
    setDictionary({ Redis: 'reddis', Kafka: 'kafka' });
    const unaffected = await provider.synthesize('Redis works', 'af_heart', 1);
    expect(unaffected.cached).toBe(true);
    expect(cacheEntries(dataDir)).toHaveLength(8);
  });

  it('fails and caches nothing when a word is not spoken', async () => {
    const { provider, dataDir } = setup();
    const error = await provider
      .synthesize('please drop this', 'af_heart', 1)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TtsWordError);
    expect((error as TtsWordError).problems).toEqual([
      'word not spoken: drop (word 1, read as "drop")',
    ]);
    expect(existsSync(join(dataDir, 'tts', 'cache')) && cacheEntries(dataDir)).toEqual([]);
  });

  it('refuses an engine whose versions differ from the lock files', async () => {
    const { provider } = setup({ reported: { ...identity, packages: { kokoro: '0.8.0' } } });
    await expect(provider.synthesize('hello', 'af_heart', 1)).rejects.toThrow(
      /does not match its lock files \(kokoro 0\.8\.0 \(uv\.lock: 0\.9\.4\)\)/,
    );
  });

  it('refuses a voice that is not installed before starting the engine', async () => {
    const { provider, server } = setup();
    await expect(provider.synthesize('hello', 'am_onyx', 1)).rejects.toThrow(/not installed/);
    expect(server.starts()).toBe(0);
  });

  it('refuses text without words', async () => {
    const { provider } = setup();
    await expect(provider.synthesize(' — ', 'af_heart', 1)).rejects.toThrow(/no words/);
  });
});

/** A fresh provider on the same data dir, as a second run would have. */
async function createAndSynthesize(dataDir: string, text: string) {
  const server = fakeServer('ok', identity);
  const own = createKokoroProvider({
    dataDir,
    client: createKokoroClient({ spawn: server.spawn }),
    identity,
    pronunciations: () => ({}),
  });
  const result = await own.synthesize(text, 'af_heart', 1);
  await own.close();
  return { result, starts: server.starts() };
}
