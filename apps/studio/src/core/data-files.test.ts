import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contentHash,
  readDataJson,
  readDataText,
  resolveDataPath,
  runDir,
  sourceTextPath,
  writeDataJson,
  writeDataText,
} from './data-files.ts';

const dataDir = mkdtempSync(join(tmpdir(), 'data-files-'));

describe('data file paths', () => {
  it('builds relative POSIX paths', () => {
    expect(runDir(12)).toBe('runs/12');
    expect(sourceTextPath(3, 7, 'abc')).toBe('topics/3/sources/7/abc.txt');
  });

  it('hashes text as sha256 hex', () => {
    expect(contentHash('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it.each(['../outside.json', '/etc/passwd', '.', 'runs/../../x'])('refuses %s', (relPath) => {
    expect(() => resolveDataPath(dataDir, relPath)).toThrow(/outside the data dir/);
  });
});

describe('data file I/O', () => {
  it('round-trips JSON under a run dir, creating parents', () => {
    const relPath = `${runDir(1)}/steps/director.out.json`;
    expect(writeDataJson(dataDir, relPath, { beats: [1, 2] })).toBe(relPath);
    expect(readDataJson(dataDir, relPath)).toEqual({ beats: [1, 2] });
  });

  it('round-trips text', () => {
    const relPath = sourceTextPath(1, 1, contentHash('body'));
    writeDataText(dataDir, relPath, 'body');
    expect(readDataText(dataDir, relPath)).toBe('body');
  });
});
