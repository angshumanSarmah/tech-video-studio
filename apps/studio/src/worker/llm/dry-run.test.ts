import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dryRunTransport, loadDryRunFixtures, recordedInOrder } from './dry-run.ts';
import type { TransportRequest } from './types.ts';

const request = (role: TransportRequest['role']): TransportRequest => ({
  role,
  model: 'm',
  messages: [{ role: 'user', content: 'x' }],
});

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('dryRunTransport', () => {
  it('replays each role in order, with defaults and parsed usage', async () => {
    const transport = dryRunTransport({
      director: [
        {
          content: '{"n":1}',
          usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 60, completion_tokens: 7 },
        },
        { content: '{"n":2}', reasoningContent: 'why' },
      ],
      researcher: [{ content: '{"r":1}' }],
    });
    expect(await transport.send(request('director'))).toEqual({
      content: '{"n":1}',
      reasoningContent: null,
      servedModel: 'dry-run',
      finishReason: 'stop',
      usage: { inCached: 60, inUncached: 40, out: 7, reasoning: 0 },
      rawUsage: { prompt_tokens: 100, prompt_cache_hit_tokens: 60, completion_tokens: 7 },
    });
    expect(await transport.send(request('researcher'))).toMatchObject({ content: '{"r":1}' });
    expect(await transport.send(request('director'))).toMatchObject({
      content: '{"n":2}',
      reasoningContent: 'why',
    });
    await expect(transport.send(request('director'))).rejects.toThrow(/No recorded director/);
    await expect(transport.send(request('curator'))).rejects.toThrow(/No recorded curator/);
  });

  it('honours an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const transport = dryRunTransport({ director: [{ content: '{}' }] });
    await expect(
      transport.send({ ...request('director'), signal: controller.signal }),
    ).rejects.toThrow('stop');
  });
});

describe('dryRunTransport: per replay key', () => {
  const keyed = () =>
    dryRunTransport({
      generator: {
        'beat-1': [{ content: '{"b":"1a"}' }, { content: '{"b":"1b"}' }],
        'beat-2': [{ content: '{"b":"2"}' }],
      },
    });
  const generator = (replayKey?: string): TransportRequest => ({
    ...request('generator'),
    ...(replayKey ? { replayKey } : {}),
  });

  it("replays each key's queue in order, whatever order the keys are called in", async () => {
    const transport = keyed();
    expect(await transport.send(generator('beat-2'))).toMatchObject({ content: '{"b":"2"}' });
    expect(await transport.send(generator('beat-1'))).toMatchObject({ content: '{"b":"1a"}' });
    expect(await transport.send(generator('beat-1'))).toMatchObject({ content: '{"b":"1b"}' });
    await expect(transport.send(generator('beat-2'))).rejects.toThrow(
      'No recorded generator response left for "beat-2" (dry run)',
    );
  });

  it('refuses a call without a key, and a key with no recording', async () => {
    const transport = keyed();
    await expect(transport.send(generator())).rejects.toThrow(/recorded per key/);
    await expect(transport.send(generator('beat-9'))).rejects.toThrow(/for "beat-9"/);
  });

  it('ignores the key for a role recorded in call order', async () => {
    const transport = dryRunTransport({ director: [{ content: '{}' }] });
    const send = { ...request('director'), replayKey: 'beat-1' };
    await expect(transport.send(send)).resolves.toMatchObject({ content: '{}' });
  });
});

describe('loadDryRunFixtures', () => {
  it('reads a recording per replay key', () => {
    dir = mkdtempSync(join(tmpdir(), 'llm-fixtures-'));
    writeFileSync(join(dir, 'generator.json'), JSON.stringify({ b1: [{ content: '{}' }] }));
    expect(loadDryRunFixtures(dir).generator).toEqual({
      b1: [
        {
          content: '{}',
          reasoningContent: null,
          servedModel: 'dry-run',
          finishReason: 'stop',
          usage: null,
        },
      ],
    });
    expect(() => recordedInOrder(dir!, 'generator')).toThrow(/recorded per key/);
  });

  it('reads <role>.json files and ignores the rest', () => {
    dir = mkdtempSync(join(tmpdir(), 'llm-fixtures-'));
    writeFileSync(join(dir, 'director.json'), JSON.stringify([{ content: '{"a":1}' }]));
    writeFileSync(join(dir, 'notes.json'), '[]');
    writeFileSync(join(dir, 'README.md'), '# fixtures');
    expect(loadDryRunFixtures(dir)).toEqual({
      director: [
        {
          content: '{"a":1}',
          reasoningContent: null,
          servedModel: 'dry-run',
          finishReason: 'stop',
          usage: null,
        },
      ],
    });
  });

  it('rejects a malformed fixture file', () => {
    dir = mkdtempSync(join(tmpdir(), 'llm-fixtures-'));
    writeFileSync(join(dir, 'director.json'), JSON.stringify([{ text: 'x' }]));
    expect(() => loadDryRunFixtures(dir!)).toThrow();
  });
});
