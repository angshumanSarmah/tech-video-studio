import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { narrationWords } from '@explainer-studio/shared';
import type { FixtureTopicId } from '../agents/fixture-topics.ts';
import { loadTimingFixture } from '../agents/generator/timing-fixture.ts';
import { makeWav } from '../render/testing.ts';
import type { TtsProvider } from '../tts/provider.ts';

/**
 * Test helpers for repairs: a TTS that narrates a fixture topic as its committed timing fixture
 * does (so unchanged beats time exactly as recorded) and any other text at a steady pace; it can
 * fail once on a text, to stand in for a crash. Not imported by any entrypoint.
 */

/** Seconds per word for text the timing fixture does not know. */
export const NEW_TEXT_WORD_SEC = 0.4;

export interface FixtureTts {
  readonly provider: TtsProvider;
  readonly calls: string[];
  /** Make the next synthesis of `text` throw. */
  failOnce(text: string): void;
}

export function fixtureTts(topic: FixtureTopicId, wavDir: string): FixtureTts {
  const known = new Map(loadTimingFixture(topic).beats.map((b) => [b.narration, b]));
  const calls: string[] = [];
  const failing = new Set<string>();
  mkdirSync(wavDir, { recursive: true });
  const provider: TtsProvider = {
    synthesize(text) {
      calls.push(text);
      if (failing.delete(text)) return Promise.reject(new Error('TTS crashed (test)'));
      const fixture = known.get(text);
      const words =
        fixture?.words ??
        narrationWords(text).map((w, i) => ({
          text: w,
          startSec: 0.2 + i * NEW_TEXT_WORD_SEC,
          endSec: 0.2 + (i + 1) * NEW_TEXT_WORD_SEC - 0.05,
        }));
      const durationSec = fixture?.durationSec ?? (words.at(-1)?.endSec ?? 0) + 0.25;
      const wavPath = join(wavDir, `${calls.length}.wav`);
      writeFileSync(wavPath, makeWav(new Array<number>(Math.round(durationSec * 1000)).fill(1000)));
      return Promise.resolve({
        wavPath,
        words: [...words],
        durationSec,
        cached: fixture !== undefined,
      });
    },
    close: () => Promise.resolve(),
  };
  return { provider, calls, failOnce: (text) => failing.add(text) };
}
