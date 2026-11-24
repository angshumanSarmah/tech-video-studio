import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { withRegistryChecks } from '@explainer-studio/renderer/catalog';
import {
  validateVideoSpec,
  type BeatScript,
  type SpecError,
  type TimingSettings,
  type VideoSpec,
} from '@explainer-studio/shared';
import { narrationTrackPath, resolveDataPath } from '#core/data-files.ts';
import type { TtsOptions } from '../tts/options.ts';
import type { TtsProvider } from '../tts/provider.ts';
import { timeNarration, type NarratedBeat } from './step.ts';

/**
 * Narrating a spec (the `tts` job's core, shared with the Curator's repairs): synthesise each
 * beat (cached by the provider, so unchanged beats cost nothing), time the track with the run's
 * pauses (landing holds once the spec has scenes), write the track under its content hash and
 * validate the timed spec. No spec version is saved here.
 */

export async function synthesizeScript(
  tts: TtsProvider,
  script: readonly BeatScript[],
  { voice, speed }: TtsOptions,
  signal: AbortSignal,
  onBeat?: (beatId: string, index: number, cached: boolean) => void,
): Promise<NarratedBeat[]> {
  const beats: NarratedBeat[] = [];
  for (const [i, beat] of script.entries()) {
    signal.throwIfAborted();
    const result = await tts.synthesize(beat.narration, voice, speed, { signal });
    beats.push({
      beatId: beat.beatId,
      durationSec: result.durationSec,
      words: result.words,
      wav: readFileSync(result.wavPath),
    });
    onBeat?.(beat.beatId, i, result.cached);
  }
  return beats;
}

/** The spec with its timing layer, the track written; refused when it has errors. */
export function timedSpec(
  dataDir: string,
  runId: number,
  spec: VideoSpec,
  beats: readonly NarratedBeat[],
  pauses: TimingSettings,
): { spec: VideoSpec; endSec: number } {
  const timed = timeNarration(spec, beats, pauses);
  const audioFile = writeTrack(dataDir, runId, timed.track);
  return {
    spec: checkedSpec({ ...spec, timing: { audioFile, ...timed.timing } }),
    endSec: timed.timing.endSec ?? 0,
  };
}

/** Writes the track under its content hash (skipped when it exists); returns its data path. */
function writeTrack(dataDir: string, runId: number, track: Uint8Array): string {
  const relPath = narrationTrackPath(runId, createHash('sha256').update(track).digest('hex'));
  const path = resolveDataPath(dataDir, relPath);
  if (existsSync(path)) return relPath;
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  try {
    writeFileSync(partial, track);
    renameSync(partial, path);
  } finally {
    rmSync(partial, { force: true });
  }
  return relPath;
}

/** The timed spec, refused when it has validation or registry errors (warnings go to the gate). */
function checkedSpec(spec: VideoSpec): VideoSpec {
  const result = withRegistryChecks(validateVideoSpec(spec), spec);
  if (!result.ok) throw new Error(`The timed spec is invalid:\n${formatSpecIssues(result.errors)}`);
  return result.spec;
}

export function formatSpecIssues(issues: readonly SpecError[]): string {
  return issues.map((e) => `  ${e.path} [${e.code}] ${e.message}`).join('\n');
}
