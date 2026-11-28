import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

/** A draft's files (P1C.12 A4): each variant's house SVG and each round's preview sheet. */
export function assetDraftDir(assetId: string): string {
  return posix.join('assets', 'drafts', assetId);
}

export function assetDraftVariantPath(assetId: string, round: number, number: number): string {
  return posix.join(assetDraftDir(assetId), `r${round}-v${number}.svg`);
}

export function assetDraftSheetPath(assetId: string, round: number): string {
  return posix.join(assetDraftDir(assetId), `sheet-${round}.png`);
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

/** A run's narration track (`timing.audioFile`), named by its content so reruns write the same file. */
export function narrationTrackPath(runId: number, contentHash: string): string {
  return posix.join(runDir(runId), 'audio', `narration-${contentHash.slice(0, 16)}.wav`);
}

/** What one research step read (`ResearchInputSchema`): chunks sent and chunks left out. */
export function researchInputPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'research', `input-${stepId}.json`);
}

/** One research step's notes (`ResearchNotesSchema`): the gate-1 input. */
export function researchNotesPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'research', `notes-${stepId}.json`);
}

/** What one Director step read (`DirectorInputSchema`), besides the research notes. */
export function directInputPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'direct', `input-${stepId}.json`);
}

/** One Director step's plan (`DirectorPlanSchema`): the gate-2 input. */
export function directPlanPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'direct', `plan-${stepId}.json`);
}

/** What one Scriptwriter step read (`ScriptwriterInputSchema`), besides the plan and notes. */
export function scriptInputPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'script', `input-${stepId}.json`);
}

/** One Scriptwriter step's script (`ScriptwriterOutputSchema`). */
export function scriptOutputPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'script', `script-${stepId}.json`);
}

/** What one `generate` job read (`GenerateInputSchema`): the pinned spec, the beat to redo. */
export function generateInputPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'generate', `input-${stepId}.json`);
}

/** One `generate` job's result (`GenerateOutputSchema`): beats, saved version, warnings left. */
export function generateOutputPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'generate', `output-${stepId}.json`);
}

/** What one `curate` job read (`CurateInputSchema`): the pinned spec, the plan and notes steps. */
export function curateInputPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'curate', `input-${stepId}.json`);
}

/** One `curate` job's findings (`CuratorReportSchema`): the gate-3 input. */
export function curateReportPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'curate', `report-${stepId}.json`);
}

/** What one repair read (`RepairInputSchema`): the pinned spec version and the requests. */
export function repairInputPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'repair', `input-${stepId}.json`);
}

/** One repair's result (`RepairOutputSchema`): what each beat got and the saved version. */
export function repairOutputPath(runId: number, stepId: number): string {
  return posix.join(runDir(runId), 'repair', `output-${stepId}.json`);
}

/** One step of a repair for one beat (`kind`: script, narrate, remap), its input or output. */
export function repairBeatStepPath(
  runId: number,
  beatId: string,
  kind: string,
  stepId: number,
  side: 'input' | 'output',
): string {
  return posix.join(runDir(runId), 'repair', beatId, `${kind}-${side}-${stepId}.json`);
}

/** What one Generator beat step read (`GeneratorBeatInputSchema`: input hash, prompt). */
export function beatSceneInputPath(runId: number, beatId: string, stepId: number): string {
  return posix.join(runDir(runId), 'generate', beatId, `input-${stepId}.json`);
}

/** One Generator beat step's board (`GeneratorBeatOutputSchema`: scene, asset swaps). */
export function beatSceneOutputPath(runId: number, beatId: string, stepId: number): string {
  return posix.join(runDir(runId), 'generate', beatId, `scene-${stepId}.json`);
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

/** What would stop the final render of the version the draft shows (written with the draft). */
export function finalCheckPath(runId: number): string {
  return posix.join(runDir(runId), 'final-check.json');
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

/** The final video's subtitles (`render_final`): the cues it burns in, as SubRip. */
export function exportSubtitlesPath(runId: number, slug: string): string {
  return posix.join('exports', String(runId), `${slug}.srt`);
}

/** The pronunciation dictionary (`PronunciationsSchema`), applied before every synthesis. */
export function pronunciationsPath(): string {
  return posix.join('config', 'pronunciations.json');
}

/** TTS output shared by every run, content-addressed by the synthesis cache key. */
export function ttsCachePath(key: string, extension: 'wav' | 'json'): string {
  return posix.join('tts', 'cache', `${key}.${extension}`);
}

/** Voice comparison samples written by `tts:fixture`. */
export function ttsVoiceSamplesDir(): string {
  return posix.join('tts', 'voice-samples');
}

/**
 * One LLM call's prompt and response files (`llm_calls.prompt_path` / `response_path`): under
 * the run, or under `llm/` for calls outside a run. `callKey` is unique per call (time + random),
 * so retries and reruns never overwrite an earlier call's files.
 */
export function llmCallPaths(
  runId: number | null,
  callKey: string,
): { readonly prompt: string; readonly response: string } {
  const dir = runId === null ? 'llm' : posix.join(runDir(runId), 'llm');
  return {
    prompt: posix.join(dir, `${callKey}.prompt.json`),
    response: posix.join(dir, `${callKey}.response.json`),
  };
}

/** Extracted source text is content-addressed so re-fetching never overwrites an older version. */
export function sourceTextPath(topicId: number, sourceId: number, contentHash: string): string {
  return posix.join('topics', String(topicId), 'sources', String(sourceId), `${contentHash}.txt`);
}

/** A source's chunks (`SourceChunksFileSchema`), next to the text version they were cut from. */
export function sourceChunksPath(topicId: number, sourceId: number, contentHash: string): string {
  return posix.join(
    'topics',
    String(topicId),
    'sources',
    String(sourceId),
    `${contentHash}.chunks.json`,
  );
}

/**
 * An uploaded source file (`sources.file_path`), stored before its row exists (the row needs the
 * path): under the topic, in a folder named by the file's hash, with its sanitised original name
 * (the title falls back to it).
 */
export function sourceUploadPath(topicId: number, fileHash: string, fileName: string): string {
  const safe = posix.basename(fileName.replaceAll('\\', '/')).replace(/[^\w.-]+/g, '_');
  return posix.join('topics', String(topicId), 'uploads', fileHash.slice(0, 16), safe || 'file');
}

/** A reference video's folder (P1C.11): its breakdown, record and attachments. */
export function referenceDir(slug: string): string {
  return posix.join('references', slug);
}

/** The breakdown as pasted (or as committed, for a seed). */
export function referenceBreakdownPath(slug: string): string {
  return posix.join(referenceDir(slug), 'breakdown.md');
}

/** The checked `ReferenceRecord`. */
export function referenceRecordPath(slug: string): string {
  return posix.join(referenceDir(slug), 'record.json');
}

/** A screenshot kept with the reference, content-addressed, with its sanitised extension. */
export function referenceAttachmentPath(slug: string, fileHash: string, extension: string): string {
  return posix.join(referenceDir(slug), 'attachments', `${fileHash.slice(0, 16)}${extension}`);
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

/**
 * Writes bytes to a content-addressed path once: an existing file already holds them. Written to
 * a `.partial` file and renamed, so a crash never leaves a half-written file that is then kept.
 */
export function writeDataFileOnce(dataDir: string, relPath: string, bytes: Uint8Array): string {
  const abs = resolveDataPath(dataDir, relPath);
  if (existsSync(abs)) return relPath;
  mkdirSync(dirname(abs), { recursive: true });
  const partial = `${abs}.partial`;
  writeFileSync(partial, bytes);
  renameSync(partial, abs);
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
