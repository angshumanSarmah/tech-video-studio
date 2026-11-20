import { estimateBeatTimings } from '@explainer-studio/shared';
import rateLimiterJson from '../../fixtures/rate-limiter.json';

type Json = Record<string, unknown>;
type EventJson = { action: string; targets: string[]; [key: string]: unknown };
type SpecJson = Json & { scenes: { elements?: Json[]; patterns?: Json[]; events?: EventJson[] }[] };

/**
 * A fresh copy of the rate-limiter fixture, which passes the registry checks (its payoff beat uses
 * the `flood_then_funnel` pattern). Tests mutate the copy.
 */
export function fixtureSpec(): SpecJson {
  const copy: unknown = structuredClone(rateLimiterJson);
  return copy as SpecJson;
}

/**
 * Sets `spec.timing` to the estimated timing with `holdSec` more silence after `beatId`'s
 * narration (as a landing hold leaves it): every later beat starts `holdSec` later. Mutates `spec`.
 */
export function withHoldAfter(spec: SpecJson, beatId: string, holdSec: number): SpecJson {
  const script = spec.script as { beatId: string; narration: string }[];
  const beats = estimateBeatTimings(script.map((s) => ({ ...s, tags: [], statCards: [] })));
  const holdFrom = beats.findIndex((b) => b.beatId === beatId) + 1;
  const shift = (sec: number, i: number) => (i >= holdFrom ? sec + holdSec : sec);
  const timed = beats.map((beat, i) => ({
    ...beat,
    startSec: shift(beat.startSec, i),
    endSec: shift(beat.endSec, i),
    words: beat.words.map((w) => ({
      ...w,
      startSec: shift(w.startSec, i),
      endSec: shift(w.endSec, i),
    })),
  }));
  const lastEnd = timed.at(-1)?.endSec ?? 0;
  spec.timing = {
    audioFile: 'runs/1/narration.wav',
    beats: timed,
    events: [],
    endSec: lastEnd + 0.5,
  };
  return spec;
}
