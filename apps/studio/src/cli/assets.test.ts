import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAssetLibrary } from '#core/assets/library.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { parseCommand, UsageError } from './args.ts';
import { runCli } from './cli.ts';
import { cliContext, fakeIo } from './testing.ts';

/** `studio assets add` (P1C.12) through `runCli`. */

let t: TestDb;
let dir: string;
beforeEach(() => {
  t = createTestDb();
  dir = mkdtempSync(join(tmpdir(), 'studio-cli-assets-'));
});
afterEach(() => t.cleanup());

async function cli(args: string[]) {
  const io = fakeIo();
  const code = await runCli(args, cliContext(t, io, 'tokenizer'));
  return { code, out: io.lines.join('\n'), err: io.errors.join('\n') };
}

const svgFile = (name: string, body: string) => {
  const file = join(dir, name);
  writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><title>x</title>${body}</svg>`,
  );
  return file;
};

describe('studio assets add', () => {
  it('adds a sanitized SVG, approved, and says what it fixed', async () => {
    const file = svgFile(
      'reel.svg',
      '<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" />',
    );
    const added = await cli([
      'assets',
      'add',
      file,
      '--id',
      'tape_reel',
      '--name',
      'Tape reel',
      '--family',
      'object',
      '--tags',
      'tape, backup',
      '--alias',
      'reel',
    ]);
    expect(added.code).toBe(0);
    expect(added.out).toContain(
      'Added tape_reel (object, LicenseRef-own): assets/tape_reel.svg, approved.',
    );
    expect(added.out).toContain('fixed: <title> dropped.');
    const [asset] = loadAssetLibrary(t.db, t.dataDir, ['tape_reel']).assets;
    expect(asset).toMatchObject({ tags: ['tape', 'backup'], aliases: ['reel'] });
  });

  it('refuses an unsafe file with its problems (exit 1) and adds nothing', async () => {
    const file = svgFile('bad.svg', '<path d="M4 12h16" onclick="alert(1)" />');
    const refused = await cli([
      'assets',
      'add',
      file,
      '--id',
      'bad',
      '--name',
      'Bad',
      '--family',
      'symbol',
    ]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('$.svg: Refused: <path> has an event handler (onclick).');
    expect(loadAssetLibrary(t.db, t.dataDir, ['bad']).assets).toEqual([]);
  });

  it('needs the file, id, name and family', () => {
    expect(() => parseCommand(['assets', 'add', 'x.svg', '--id', 'x'])).toThrow(UsageError);
    expect(() => parseCommand(['assets', 'list'])).toThrow(/Unknown assets command/);
  });
});
