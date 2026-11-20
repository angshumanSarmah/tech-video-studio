import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assetSvgPath,
  beatDraftMetaPath,
  beatDraftPath,
  beatStillPath,
  contentHash,
  exportVideoPath,
  missingAssetsPath,
  narrationTrackPath,
  pronunciationsPath,
  readDataJson,
  readDataText,
  resolveDataPath,
  runDir,
  runBeatsDir,
  runDraftPath,
  sourceChunksPath,
  sourceUploadPath,
  runLogosDir,
  sourceTextPath,
  specVersionPath,
  stillsManifestPath,
  ttsCachePath,
  ttsVoiceSamplesDir,
  writeDataJson,
  writeDataText,
} from './data-files.ts';

const dataDir = mkdtempSync(join(tmpdir(), 'data-files-'));

describe('data file paths', () => {
  it('builds relative POSIX paths', () => {
    expect(runDir(12)).toBe('runs/12');
    expect(sourceTextPath(3, 7, 'abc')).toBe('topics/3/sources/7/abc.txt');
    expect(assetSvgPath('server')).toBe('assets/server.svg');
    expect(runLogosDir(4)).toBe('runs/4/logos');
    expect(missingAssetsPath(4)).toBe('runs/4/missing-assets.json');
  });

  it('builds render output paths', () => {
    expect(specVersionPath(4, 2)).toBe('runs/4/specs/v2.json');
    expect(runBeatsDir(4)).toBe('runs/4/beats');
    expect(beatDraftPath(4, 'hook')).toBe('runs/4/beats/hook.draft.mp4');
    expect(beatDraftMetaPath(4, 'hook')).toBe('runs/4/beats/hook.draft.json');
    expect(runDraftPath(4)).toBe('runs/4/draft.mp4');
    expect(beatStillPath(4, 'hook')).toBe('runs/4/stills/hook.png');
    expect(stillsManifestPath(4)).toBe('runs/4/stills/stills.json');
    expect(exportVideoPath(4, 'rate-limiter')).toBe('exports/4/rate-limiter.mp4');
  });

  it('builds TTS paths', () => {
    expect(pronunciationsPath()).toBe('config/pronunciations.json');
    expect(ttsCachePath('ab12', 'wav')).toBe('tts/cache/ab12.wav');
    expect(ttsCachePath('ab12', 'json')).toBe('tts/cache/ab12.json');
    expect(ttsVoiceSamplesDir()).toBe('tts/voice-samples');
    expect(narrationTrackPath(4, 'abcdef0123456789ffff')).toBe(
      'runs/4/audio/narration-abcdef0123456789.wav',
    );
  });

  it('builds source paths: chunks next to their text, uploads by file hash', () => {
    const hash = 'ab'.repeat(32);
    expect(sourceChunksPath(3, 9, hash)).toBe(`topics/3/sources/9/${hash}.chunks.json`);
    expect(sourceUploadPath(3, hash, 'Field notes (v2).pdf')).toBe(
      'topics/3/uploads/abababababababab/Field_notes_v2_.pdf',
    );
    expect(sourceUploadPath(3, hash, '..\\..\\evil/../x.md')).toBe(
      'topics/3/uploads/abababababababab/x.md',
    );
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
