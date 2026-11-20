import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheFiles, commitCachedSynthesis, readCachedSynthesis, ttsCacheKey } from './cache.ts';

const input = {
  text: 'Redis works',
  spokenText: 'reddis works',
  voice: 'af_heart',
  voiceHash: 'v1',
  speed: 1,
  model: { packages: { kokoro: '0.9.4' }, revision: 'r', files: { 'kokoro-v1_0.pth': 'w' } },
};

describe('ttsCacheKey', () => {
  it('is stable for the same inputs', () => {
    expect(ttsCacheKey(input)).toBe(ttsCacheKey({ ...input }));
    expect(ttsCacheKey(input)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['text', { text: 'Redis work' }],
    ['spoken text', { spokenText: 'redis works' }],
    ['voice', { voice: 'bf_emma' }],
    ['voice file', { voiceHash: 'v2' }],
    ['speed', { speed: 1.1 }],
    ['package versions', { model: { ...input.model, packages: { kokoro: '0.9.5' } } }],
    ['weights', { model: { ...input.model, files: { 'kokoro-v1_0.pth': 'w2' } } }],
  ])('changes with the %s', (_name, change) => {
    expect(ttsCacheKey({ ...input, ...change })).not.toBe(ttsCacheKey(input));
  });
});

describe('readCachedSynthesis', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tts-cache-'));
  const entry = {
    key: 'k1',
    text: 'hi',
    spokenText: 'hi',
    voice: 'af_heart',
    speed: 1,
    durationSec: 0.5,
    words: [{ text: 'hi', startSec: 0.1, endSec: 0.3 }],
  };

  it('reads back a committed entry', () => {
    const files = cacheFiles(dataDir, 'k1');
    mkdirSync(dirname(files.wav), { recursive: true });
    writeFileSync(`${files.wav}.partial`, 'wav');
    commitCachedSynthesis(files, `${files.wav}.partial`, entry);
    expect(readCachedSynthesis(files, 'k1')).toEqual(entry);
  });

  it('misses an entry without its WAV, with unreadable meta or another key', () => {
    const noWav = cacheFiles(dataDir, 'k2');
    writeFileSync(noWav.meta, JSON.stringify({ ...entry, key: 'k2' }));
    expect(readCachedSynthesis(noWav, 'k2')).toBeUndefined();

    const corrupt = cacheFiles(dataDir, 'k3');
    writeFileSync(corrupt.wav, 'wav');
    writeFileSync(corrupt.meta, '{');
    expect(readCachedSynthesis(corrupt, 'k3')).toBeUndefined();

    expect(readCachedSynthesis(cacheFiles(dataDir, 'k1'), 'other')).toBeUndefined();
  });
});
