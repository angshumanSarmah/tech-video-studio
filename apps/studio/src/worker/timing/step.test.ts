import { beatSettledOffsets, withRegistryChecks } from '@explainer-studio/renderer/catalog';
import { rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import { validateVideoSpec, type VideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { parseWav } from '../render/audio.ts';
import { closestWord, resolveEventTimes } from './anchors.ts';
import { TimingError, timeNarration } from './step.ts';
import { FAKE_SAMPLE_RATE, fakeNarratedBeat } from './testing.ts';

const pauses = { beatGapSec: 0, landingSec: 0, endTailSec: 0.5 };
const narrated = rateLimiterSpec.script.map(fakeNarratedBeat);

function timedSpec(spec: VideoSpec, timing: ReturnType<typeof timeNarration>['timing']) {
  return { ...spec, timing: { audioFile: 'runs/1/audio/narration.wav', ...timing } };
}

describe('timeNarration', () => {
  it('times the fixture into a valid spec with a track as long as the timing', () => {
    const { timing, track } = timeNarration(rateLimiterSpec, narrated, pauses);
    const spec = timedSpec(rateLimiterSpec, timing);
    const result = withRegistryChecks(validateVideoSpec(spec), spec);
    expect(result.errors).toEqual([]);
    const layout = parseWav(track);
    const trackSec = ((layout?.dataEnd ?? 0) - (layout?.dataStart ?? 0)) / 2 / FAKE_SAMPLE_RATE;
    expect(trackSec).toBeCloseTo(timing.endSec ?? 0, 2);
    expect(timing.pauses).toEqual(pauses);
    expect(timing.events.length).toBe(
      rateLimiterSpec.scenes.reduce((n, s) => n + s.events.length, 0),
    );
  });

  it('holds each beat until landingSec after its last event has settled', () => {
    const landing = { ...pauses, landingSec: 0.75 };
    const { timing } = timeNarration(rateLimiterSpec, narrated, landing);
    const settled = beatSettledOffsets(timedSpec(rateLimiterSpec, timing) as never);
    timing.beats.slice(0, -1).forEach((beat, i) => {
      const next = timing.beats[i + 1]!;
      const offset = settled.get(beat.beatId)!;
      expect(next.startSec).toBeCloseTo(Math.max(beat.endSec, beat.startSec + offset + 0.75), 3);
    });
    const held = timing.beats.slice(1).filter((b, i) => b.startSec > timing.beats[i]!.endSec);
    expect(held.length).toBeGreaterThan(0);
  });

  it('gets no landing holds before the spec has scenes', () => {
    const scriptOnly: VideoSpec = { ...rateLimiterSpec, scenes: undefined };
    const { timing } = timeNarration(scriptOnly, narrated, { ...pauses, landingSec: 1 });
    timing.beats.slice(1).forEach((beat, i) => {
      expect(beat.startSec).toBe(timing.beats[i]!.endSec);
    });
  });

  it('fails when a beat has no narration audio', () => {
    expect(() => timeNarration(rateLimiterSpec, narrated.slice(1), pauses)).toThrow(TimingError);
  });

  it('fails an anchor that matches no word, suggesting the closest one', () => {
    const spec = structuredClone(rateLimiterSpec);
    spec.scenes[0]!.events[0]!.at = { type: 'word_text', text: 'clint', occurrence: 1 };
    expect(() => timeNarration(spec, narrated, pauses)).toThrow(
      /beat "hook" event 0: "clint" \(occurrence 1\) is not in the narration \(closest word: "client"\)/,
    );
  });
});

describe('anchors', () => {
  it('suggests the closest narration word', () => {
    expect(closestWord('Refil', ['the', 'refill', 'rate'])).toBe('refill');
    expect(closestWord('x', [])).toBeUndefined();
  });

  it('resolves word anchors to their word starts on the track', () => {
    const { timing } = timeNarration(rateLimiterSpec, narrated, pauses);
    const { events, problems } = resolveEventTimes(rateLimiterSpec, timing.beats);
    expect(problems).toEqual([]);
    expect(events[0]?.beatId).toBe('hook');
    expect(events[0]?.atSec).toBeGreaterThan(0);
  });
});
