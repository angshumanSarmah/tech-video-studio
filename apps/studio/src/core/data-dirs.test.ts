import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_SUBDIRS, ensureDataDirs } from './data-dirs.ts';

describe('ensureDataDirs', () => {
  it('creates every subdirectory and is idempotent', () => {
    const dataDir = join(mkdtempSync(join(tmpdir(), 'data-')), 'data');
    ensureDataDirs(dataDir);
    ensureDataDirs(dataDir);
    for (const sub of DATA_SUBDIRS) expect(existsSync(join(dataDir, sub))).toBe(true);
  });
});
