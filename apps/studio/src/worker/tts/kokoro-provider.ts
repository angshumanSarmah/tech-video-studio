import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Pronunciations } from '@explainer-studio/shared';
import { alignWords } from './alignment.ts';
import { cacheFiles, commitCachedSynthesis, readCachedSynthesis, ttsCacheKey } from './cache.ts';
import type { KokoroClient } from './kokoro-client.ts';
import { identityMismatches, voiceHash, type ModelIdentity } from './model-identity.ts';
import { planSpeech } from './pronunciations.ts';
import {
  TtsWordError,
  type SynthesizeOptions,
  type TtsProvider,
  type TtsResult,
} from './provider.ts';
import { wordTimingProblems } from './word-checks.ts';

export interface KokoroProviderDeps {
  readonly dataDir: string;
  readonly client: KokoroClient;
  /** From the lock files; read once per provider. */
  readonly identity: ModelIdentity;
  /** Read on every call, so dictionary edits apply without a restart. */
  readonly pronunciations: () => Pronunciations;
}

/**
 * Kokoro behind the cache: pronunciation dictionary -> cache lookup -> server synthesis ->
 * token-to-word mapping and checks -> cache commit. Only checked results are cached.
 */
export function createKokoroProvider(deps: KokoroProviderDeps): TtsProvider {
  let verified: Promise<void> | undefined;

  /** The running server must match the lock files the cache key was built from. */
  const verifyServer = (signal?: AbortSignal) => {
    verified ??= deps.client.info(signal).then((info) => {
      const mismatches = identityMismatches(deps.identity, info);
      if (mismatches.length) {
        throw new Error(
          `The TTS env does not match its lock files (${mismatches.join('; ')}). ` +
            'Run `pnpm tts:setup`.',
        );
      }
    });
    verified.catch(() => (verified = undefined));
    return verified;
  };

  async function synthesize(
    text: string,
    voice: string,
    speed: number,
    options: SynthesizeOptions = {},
  ): Promise<TtsResult> {
    const plan = planSpeech(text, deps.pronunciations());
    if (!plan.words.length) throw new TtsWordError(['the text has no words to speak']);
    const key = ttsCacheKey({
      text,
      spokenText: plan.spokenText,
      voice,
      voiceHash: voiceHash(deps.identity, voice),
      speed,
      model: deps.identity,
    });
    const files = cacheFiles(deps.dataDir, key);
    const hit = readCachedSynthesis(files, key);
    if (hit)
      return { wavPath: files.wav, words: hit.words, durationSec: hit.durationSec, cached: true };

    await verifyServer(options.signal);
    mkdirSync(dirname(files.wav), { recursive: true });
    const partialWav = `${files.wav}.partial`;
    try {
      const synthesis = await deps.client.synthesize(
        { text: plan.spokenText, voice, speed, outPath: partialWav },
        options.signal,
      );
      const aligned = alignWords(plan, synthesis.tokens);
      if (!aligned.ok) throw new TtsWordError(aligned.problems);
      const problems = wordTimingProblems(text, aligned.words, synthesis.durationSec);
      if (problems.length) throw new TtsWordError(problems);
      commitCachedSynthesis(files, partialWav, {
        key,
        text,
        spokenText: plan.spokenText,
        voice,
        speed,
        durationSec: synthesis.durationSec,
        words: aligned.words,
      });
      return {
        wavPath: files.wav,
        words: aligned.words,
        durationSec: synthesis.durationSec,
        cached: false,
      };
    } finally {
      rmSync(partialWav, { force: true });
    }
  }

  return { synthesize, close: () => deps.client.close() };
}
