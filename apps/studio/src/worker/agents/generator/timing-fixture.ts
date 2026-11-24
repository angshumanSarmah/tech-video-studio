import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TimedWordSchema, type TimingSettings, type VideoSpec } from '@explainer-studio/shared';
import { z } from 'zod';
import { assembleTiming } from '#worker/timing/assemble.ts';
import { fixtureResponsesDir, type FixtureTopicId } from '../fixture-topics.ts';

/**
 * The committed timing fixture of a topic (P1C.7): Kokoro's word times for each beat of the
 * recorded script, so `generator:fixture` and the job tests draw against real narration without
 * Python. `generator:timing` rewrites it; a beat whose narration no longer matches the recorded
 * script fails loudly (re-run it after re-recording the Scriptwriter). Not imported by any
 * entrypoint.
 */

export const TimingFixtureSchema = z.strictObject({
  voice: z.string().min(1),
  speed: z.number().positive(),
  beats: z.array(
    z.strictObject({
      beatId: z.string().min(1),
      /** The narration the words were synthesised from. */
      narration: z.string().min(1),
      /** The beat's audio length. */
      durationSec: z.number().positive(),
      /** Seconds from the beat's audio start, one per `narrationWords` word. */
      words: z.array(TimedWordSchema),
    }),
  ),
});
export type TimingFixture = z.infer<typeof TimingFixtureSchema>;

/** The file the topic's timing lives in, next to the Generator's recorded responses. */
export function timingFixturePath(topic: FixtureTopicId): string {
  return join(dirname(fixtureResponsesDir('generator', topic)), 'timing.json');
}

export function loadTimingFixture(topic: FixtureTopicId): TimingFixture {
  return TimingFixtureSchema.parse(JSON.parse(readFileSync(timingFixturePath(topic), 'utf8')));
}

/** Where a timed fixture spec says its (absent) narration track is. */
export const FIXTURE_AUDIO_FILE = 'fixture-narration.wav';

/**
 * The spec with the fixture's timing layer, placed with `pauses` like the TTS job does before
 * any scene exists (no landing holds). Throws when a beat's narration differs from the one
 * synthesised.
 */
export function withFixtureTiming(
  spec: VideoSpec,
  fixture: TimingFixture,
  pauses: TimingSettings,
): VideoSpec {
  const byId = new Map(fixture.beats.map((b) => [b.beatId, b]));
  const stale = (spec.script ?? []).filter((s) => byId.get(s.beatId)?.narration !== s.narration);
  if (stale.length > 0) {
    const ids = stale.map((s) => s.beatId).join(', ');
    throw new Error(`The timing fixture is stale for ${ids}: run generator:timing again.`);
  }
  const beats = (spec.script ?? []).map((s) => byId.get(s.beatId)!);
  const placed = assembleTiming(beats, pauses);
  return {
    ...spec,
    timing: {
      audioFile: FIXTURE_AUDIO_FILE,
      beats: placed.beats,
      events: [],
      endSec: placed.endSec,
      pauses,
    },
  };
}
