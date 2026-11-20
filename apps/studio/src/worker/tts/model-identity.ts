import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * What a Kokoro synthesis depends on besides its inputs: package versions (from `uv.lock`) and
 * model file hashes (from `models.lock.json`). Read from the lock files, so a cache lookup never
 * needs the Python process; the running server must report the same identity.
 */
export interface ModelIdentity {
  readonly packages: Readonly<Record<string, string>>;
  readonly revision: string;
  /** sha256 per file path under `models/` (weights, config, voices). */
  readonly files: Readonly<Record<string, string>>;
}

/** Packages whose versions change the audio or the token timings. */
export const IDENTITY_PACKAGES = ['kokoro', 'misaki', 'torch', 'espeakng-loader', 'spacy'] as const;

export const ModelsLockSchema = z.object({
  repoId: z.string(),
  revision: z.string().min(1),
  files: z.record(z.string(), z.string()),
});

/** Versions of `names` in a `uv.lock` (TOML `[[package]]` tables). Pure. */
export function parseUvLockVersions(
  text: string,
  names: readonly string[],
): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const match of text.matchAll(/^\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/gmu)) {
    const [, name, version] = match;
    if (name && version && names.includes(name)) versions[name] = version;
  }
  return versions;
}

export function readModelIdentity(paths: { modelsLock: string; uvLock: string }): ModelIdentity {
  const lock = ModelsLockSchema.parse(JSON.parse(readFileSync(paths.modelsLock, 'utf8')));
  const packages = parseUvLockVersions(readFileSync(paths.uvLock, 'utf8'), IDENTITY_PACKAGES);
  const missing = IDENTITY_PACKAGES.filter((name) => !packages[name]);
  if (missing.length) throw new Error(`uv.lock has no version for: ${missing.join(', ')}`);
  return { packages, revision: lock.revision, files: lock.files };
}

/** The sha256 of a voice's file; throws a clear error when the voice is not pinned. */
export function voiceHash(identity: ModelIdentity, voice: string): string {
  const hash = identity.files[`voices/${voice}.pt`];
  if (!hash) {
    const known = Object.keys(identity.files)
      .filter((file) => file.startsWith('voices/'))
      .map((file) => file.slice('voices/'.length, -'.pt'.length));
    throw new Error(
      `TTS voice "${voice}" is not installed. Installed voices: ${known.join(', ')}. ` +
        'Add it to apps/studio/tts-python/models.lock.json and run `pnpm tts:setup`.',
    );
  }
  return hash;
}

/** Differences between the lock files and what the running server reports; empty when equal. */
export function identityMismatches(
  expected: ModelIdentity,
  reported: { packages: Record<string, string>; revision: string; files: Record<string, string> },
): string[] {
  const problems: string[] = [];
  for (const [name, version] of Object.entries(expected.packages)) {
    if (reported.packages[name] !== version) {
      problems.push(`${name} ${reported.packages[name] ?? 'missing'} (uv.lock: ${version})`);
    }
  }
  if (reported.revision !== expected.revision) problems.push('models.lock.json revision');
  for (const [file, hash] of Object.entries(expected.files)) {
    if (reported.files[file] !== hash) problems.push(`model file ${file}`);
  }
  return problems;
}
