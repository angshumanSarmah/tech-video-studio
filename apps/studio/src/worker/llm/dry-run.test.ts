import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dryRunTransport, loadDryRunFixtures } from './dry-run.ts';
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

describe('loadDryRunFixtures', () => {
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
