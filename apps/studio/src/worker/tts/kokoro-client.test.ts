import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createKokoroClient, type KokoroClient } from './kokoro-client.ts';
import { fakeServer, type FakeMode } from './testing/fake-server.ts';
import { TtsProcessError, TtsRequestError } from './tts-process.ts';

const out = mkdtempSync(join(tmpdir(), 'kokoro-client-'));
const request = (text = 'hello world') => ({
  text,
  voice: 'af_heart',
  speed: 1,
  outPath: join(out, `${Math.random()}.wav`),
});

let client: KokoroClient | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

function clientFor(mode: FakeMode, requestTimeoutMs = 10_000) {
  const server = fakeServer(mode);
  const logs: string[] = [];
  client = createKokoroClient({
    spawn: server.spawn,
    startupTimeoutMs: 10_000,
    requestTimeoutMs: () => requestTimeoutMs,
    log: (message) => logs.push(message),
  });
  return { client, server, logs };
}

describe('createKokoroClient', () => {
  it('starts the server once and reuses it', async () => {
    const { client, server } = clientFor('ok');
    const first = await client.synthesize(request('one two'));
    await client.synthesize(request('three'));
    expect(first.tokens.map((t) => t.text)).toEqual(['one', 'two']);
    expect((await client.info()).device).toBe('cpu');
    expect(server.starts()).toBe(1);
  });

  it('runs concurrent calls one at a time on the same server', async () => {
    const { client, server } = clientFor('ok');
    const results = await Promise.all([1, 2, 3].map((n) => client.synthesize(request(`w${n}`))));
    expect(results.map((r) => r.tokens[0]?.text)).toEqual(['w1', 'w2', 'w3']);
    expect(server.starts()).toBe(1);
  });

  it('restarts once after a crash and retries the call', async () => {
    const { client, server, logs } = clientFor('crash-once');
    const result = await client.synthesize(request('after crash'));
    expect(result.tokens).toHaveLength(2);
    expect(server.starts()).toBe(2);
    expect(logs.join()).toMatch(/restarting once/);
  });

  it('fails with both errors and the stderr tail when the restart crashes too', async () => {
    const { client, server } = clientFor('crash-always');
    const error = await client.synthesize(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TtsProcessError);
    expect((error as Error).message).toMatch(/failed again after one restart/);
    expect((error as Error).message).toMatch(/exited \(code 3\)/);
    expect((error as Error).message).toMatch(/fake engine: boom/);
    expect(server.starts()).toBe(2);
  });

  it('times out a hung request, restarts once, then fails', async () => {
    const { client, server } = clientFor('hang', 300);
    await expect(client.synthesize(request())).rejects.toThrow(/timed out after 300 ms/);
    expect(server.starts()).toBe(2);
  });

  it('treats a non-JSON line as a protocol failure', async () => {
    const { client } = clientFor('garbage');
    await expect(client.synthesize(request())).rejects.toThrow(/non-JSON line: not json/);
  });

  it('does not restart for a fatal startup error', async () => {
    const { client, server } = clientFor('fatal');
    await expect(client.synthesize(request())).rejects.toThrow(
      /failed to start: RuntimeError: espeak-ng fallback failed to load[\s\S]*cannot load espeak/,
    );
    expect(server.starts()).toBe(1);
  });

  it('keeps the server after an error it reports for one request', async () => {
    const { client, server } = clientFor('ok');
    await expect(client.synthesize(request('server-error'))).rejects.toBeInstanceOf(
      TtsRequestError,
    );
    await client.synthesize(request('fine'));
    expect(server.starts()).toBe(1);
  });

  it('kills the server on abort and starts a new one for the next call', async () => {
    const { client, server } = clientFor('hang');
    const controller = new AbortController();
    const pending = client.synthesize(request(), controller.signal);
    setTimeout(() => controller.abort(new Error('worker shutting down')), 200);
    await expect(pending).rejects.toThrow('worker shutting down');
    expect(server.starts()).toBe(1);
    await expect(client.synthesize(request(), AbortSignal.timeout(200))).rejects.toThrow();
    expect(server.starts()).toBe(2);
  });

  it('says how to fix a missing interpreter', async () => {
    client = createKokoroClient({
      spawn: { command: join(out, 'no-such-python'), args: [], cwd: out },
    });
    await expect(client.info()).rejects.toThrow(/Could not start the TTS process.*tts:setup/);
  });
});
