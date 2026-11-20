import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, posix, relative, resolve } from 'node:path';

/**
 * Large JSON and text live on disk; the DB stores paths relative to the data dir (POSIX
 * separators) so the data dir can move without rewriting rows.
 */

export function runDir(runId: number): string {
  return posix.join('runs', String(runId));
}

/** A library asset's house SVG file. */
export function assetSvgPath(assetId: string): string {
  return posix.join('assets', `${assetId}.svg`);
}

/** User-supplied logo files for a run's logo slots: `<slot id>.svg` or `.png`. */
export function runLogosDir(runId: number): string {
  return posix.join(runDir(runId), 'logos');
}

/** Ids the run's renders drew as placeholders (`MissingAssetListSchema`). */
export function missingAssetsPath(runId: number): string {
  return posix.join(runDir(runId), 'missing-assets.json');
}

/** A spec version's JSON (`spec_versions.json_path`). */
export function specVersionPath(runId: number, version: number): string {
  return posix.join(runDir(runId), 'specs', `v${version}.json`);
}

/** Per-beat draft clips and their cache sidecars. */
export function runBeatsDir(runId: number): string {
  return posix.join(runDir(runId), 'beats');
}

/** One beat's draft clip (`render_beat_draft`). Beat ids are spec slugs, safe as file names. */
export function beatDraftPath(runId: number, beatId: string): string {
  return posix.join(runBeatsDir(runId), `${beatId}.draft.mp4`);
}

/** The cache key a beat's draft clip was rendered with (`DraftClipMetaSchema`). */
export function beatDraftMetaPath(runId: number, beatId: string): string {
  return posix.join(runBeatsDir(runId), `${beatId}.draft.json`);
}

/** The joined draft video with the whole narration (`render_draft`). */
export function runDraftPath(runId: number): string {
  return posix.join(runDir(runId), 'draft.mp4');
}

/** One preview still per beat at its key frame (`render_stills`). */
export function beatStillPath(runId: number, beatId: string): string {
  return posix.join(runDir(runId), 'stills', `${beatId}.png`);
}

/** The stills' sidecar: their spec version and key frames (`render_stills`). */
export function stillsManifestPath(runId: number): string {
  return posix.join(runDir(runId), 'stills', 'stills.json');
}

/** The final video (`render_final`). */
export function exportVideoPath(runId: number, slug: string): string {
  return posix.join('exports', String(runId), `${slug}.mp4`);
}

/** Extracted source text is content-addressed so re-fetching never overwrites an older version. */
export function sourceTextPath(topicId: number, sourceId: number, contentHash: string): string {
  return posix.join('topics', String(topicId), 'sources', String(sourceId), `${contentHash}.txt`);
}

/** sha256 hex of UTF-8 text. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Resolves a stored relative path, refusing anything that escapes the data dir. */
export function resolveDataPath(dataDir: string, relPath: string): string {
  const abs = resolve(dataDir, relPath);
  const rel = relative(dataDir, abs);
  if (isAbsolute(relPath) || rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path is outside the data dir: ${relPath}`);
  }
  return abs;
}

export function writeDataText(dataDir: string, relPath: string, text: string): string {
  const abs = resolveDataPath(dataDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, 'utf8');
  return relPath;
}

export function readDataText(dataDir: string, relPath: string): string {
  return readFileSync(resolveDataPath(dataDir, relPath), 'utf8');
}

export function writeDataJson(dataDir: string, relPath: string, value: unknown): string {
  return writeDataText(dataDir, relPath, `${JSON.stringify(value, null, 2)}\n`);
}

/** Returns parsed JSON as `unknown`; callers validate it with the matching Zod schema. */
export function readDataJson(dataDir: string, relPath: string): unknown {
  return JSON.parse(readDataText(dataDir, relPath));
}
