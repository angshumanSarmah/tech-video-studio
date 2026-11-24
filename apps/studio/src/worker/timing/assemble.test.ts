import { describe, expect, it } from 'vitest';
import { assembleTiming, type BeatAudio } from './assemble.ts';

const none = { beatGapSec: 0, landingSec: 0, endTailSec: 0 };
const beat = (beatId: string, durationSec: number): BeatAudio => ({
  beatId,
  durationSec,
  words: [{ text: beatId, startSec: 0.2, endSec: 0.5 }],
});
const beats = [beat('a', 2), beat('b', 3), beat('c', 1)];
const starts = (pauses = none, settled = new Map<string, number>()) =>
  assembleTiming(beats, pauses, settled).beats.map((b) => b.startSec);

describe('assembleTiming', () => {
  it('places beats back to back with no pauses, words shifted onto the track', () => {
    const timing = assembleTiming(beats, none);
    expect(timing.beats.map((b) => [b.startSec, b.endSec])).toEqual([
      [0, 2],
      [2, 5],
      [5, 6],
    ]);
    expect(timing.beats[1]?.words).toEqual([{ text: 'b', startSec: 2.2, endSec: 2.5 }]);
    expect(timing.endSec).toBe(6);
  });

  it('puts the gap between beats and the tail after the last', () => {
    const timing = assembleTiming(beats, { ...none, beatGapSec: 0.4, endTailSec: 0.5 });
    expect(timing.beats.map((b) => b.startSec)).toEqual([0, 2.4, 5.8]);
    expect(timing.endSec).toBe(7.3);
  });

  it('holds landingSec after the settled point when that is past the narration', () => {
    // a settles 1.8 s in (+0.5 landing = 2.3 > 2); b settles 3.4 s in (draw past its narration).
    const settled = new Map([
      ['a', 1.8],
      ['b', 3.4],
    ]);
    expect(starts({ ...none, landingSec: 0.5 }, settled)).toEqual([0, 2.3, 6.2]);
    expect(starts({ ...none, landingSec: 0.5, beatGapSec: 0.1 }, settled)).toEqual([0, 2.4, 6.4]);
  });

  it('adds no hold where the narration already outlasts the landing', () => {
    expect(starts({ ...none, landingSec: 0.2 }, new Map([['a', 0.5]]))[1]).toBe(2);
  });

  it('adds no hold with landing off, even when an event settles past the narration', () => {
    expect(starts(none, new Map([['a', 3]]))).toEqual([0, 2, 5]);
  });

  it('extends the end by the last beat’s landing hold, then the tail', () => {
    const timing = assembleTiming(
      beats,
      { ...none, landingSec: 1, endTailSec: 0.5 },
      new Map([['c', 0.8]]),
    );
    expect(timing.endSec).toBe(5 + 0.8 + 1 + 0.5);
  });
});
