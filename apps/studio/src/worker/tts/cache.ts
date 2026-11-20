import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TimedWordSchema } from '@explainer-studio/shared';
import { z } from 'zod';
import { ttsCachePath } from '#core/data-files.ts';
import type { ModelIdentity } from './model-identity.ts';

/** Bump when token mapping, the server or the WAV format changes the cached output. */
export const TTS_PIPELINE_VERSION = 1;

export interface CacheKeyInput {
  readonly text: string;
  /** After the pronunciation dictionary: editing an entry invalidates only beats that use it. */
  readonly spokenText: string;
  readonly voice: string;
  readonly voiceHash: string;
  readonly speed: number;
  readonly model: ModelIdentity;
}

/** sha256 over everything the WAV and word list depend on. Pure. */
export function ttsCacheKey(input: CacheKeyInput): string {
  const { model, ...rest } = input;
  const material = {
    pipeline: TTS_PIPELINE_VERSION,
    ...rest,
    packages: model.packages,
    revision: model.revision,
    weights: model.files['kokoro-v1_0.pth'] ?? '',
    config: model.files['config.json'] ?? '',
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

export const CachedSynthesisSchema = z.object({
  key: z.string(),
  text: z.string(),
  spokenText: z.string(),
  voice: z.string(),
  speed: z.number(),
  durationSec: z.number().positive(),
  words: z.array(TimedWordSchema),
});
export type CachedSynthesis = z.infer<typeof CachedSynthesisSchema>;

export interface CacheFiles {
  readonly wav: string;
  readonly meta: string;
}

/** Absolute paths of one cache entry. The meta JSON is written last: it marks the entry complete. */
export function cacheFiles(dataDir: string, key: string): CacheFiles {
  return {
    wav: join(dataDir, ttsCachePath(key, 'wav')),
    meta: join(dataDir, ttsCachePath(key, 'json')),
  };
}

/** The cached entry, or undefined when it is missing, incomplete or unreadable (a miss). */
export function readCachedSynthesis(files: CacheFiles, key: string): CachedSynthesis | undefined {
  if (!existsSync(files.meta) || !existsSync(files.wav)) return undefined;
  try {
    const parsed = CachedSynthesisSchema.safeParse(JSON.parse(readFileSync(files.meta, 'utf8')));
    return parsed.success && parsed.data.key === key ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Moves the finished WAV into place, then writes the meta JSON (both atomic renames). */
export function commitCachedSynthesis(
  files: CacheFiles,
  partialWav: string,
  entry: CachedSynthesis,
): void {
  mkdirSync(dirname(files.meta), { recursive: true });
  renameSync(partialWav, files.wav);
  const partialMeta = `${files.meta}.partial`;
  try {
    writeFileSync(partialMeta, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    renameSync(partialMeta, files.meta);
  } finally {
    rmSync(partialMeta, { force: true });
  }
}
