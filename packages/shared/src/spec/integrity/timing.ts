import { narrationWords } from '../narration.ts';
import type { VideoSpec } from '../shape.ts';
import type { BeatTiming, TimingLayer } from '../timing.ts';
import { checkBeatCoverage } from './coverage.ts';
import { unknownReference, type SpecIssue } from './issue.ts';

export function checkTiming(spec: VideoSpec): SpecIssue[] {
  const timing = spec.timing;
  if (!timing) return [];
  return [
    ...checkBeatCoverage(spec, timing.beats, ['timing', 'beats']),
    ...checkBeatSpans(timing.beats),
    ...checkTrackEnd(timing),
    ...timing.beats.flatMap((beat, i) => checkWords(spec, beat, i)),
    ...checkEventRefs(spec, timing),
  ];
}

/** Beats follow each other on the track without overlapping. */
function checkBeatSpans(beats: readonly BeatTiming[]): SpecIssue[] {
  return beats.slice(1).flatMap((beat, j) => {
    const previous = beats[j];
    if (!previous || beat.startSec >= previous.endSec) return [];
    return [
      {
        path: ['timing', 'beats', j + 1, 'startSec'],
        code: 'timing_overlap',
        message: `Beat "${beat.beatId}" starts before "${previous.beatId}" ends.`,
      },
    ];
  });
}

/** The track does not end before its last beat's narration. */
function checkTrackEnd(timing: TimingLayer): SpecIssue[] {
  const last = timing.beats.at(-1);
  if (timing.endSec === undefined || !last || timing.endSec >= last.endSec) return [];
  return [
    {
      path: ['timing', 'endSec'],
      code: 'timing_end_before_beats',
      message: `The track ends at ${timing.endSec}s, before beat "${last.beatId}" ends (${last.endSec}s).`,
    },
  ];
}

/** Words match the narration's word count and stay inside their beat, in order. */
function checkWords(spec: VideoSpec, beat: BeatTiming, i: number): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const script = spec.script?.find((s) => s.beatId === beat.beatId);
  const expected = script && narrationWords(script.narration).length;
  if (expected !== undefined && expected !== beat.words.length) {
    issues.push({
      path: ['timing', 'beats', i, 'words'],
      code: 'timing_word_count',
      message: `Expected ${expected} timed words (one per narration word), got ${beat.words.length}.`,
    });
  }
  let cursor = beat.startSec;
  beat.words.forEach((word, w) => {
    if (word.startSec < cursor || word.endSec > beat.endSec) {
      issues.push({
        path: ['timing', 'beats', i, 'words', w],
        code: 'timing_word_outside_beat',
        message: `Word "${word.text}" is out of order or outside its beat.`,
      });
    }
    cursor = Math.max(cursor, word.startSec);
  });
  return issues;
}

/** Cached event times point at real events (only checkable once scenes exist). */
function checkEventRefs(spec: VideoSpec, timing: TimingLayer): SpecIssue[] {
  if (!spec.scenes) return [];
  const eventCounts = new Map(spec.scenes.map((s) => [s.beatId, s.events.length]));
  return timing.events.flatMap((event, i) => {
    const count = eventCounts.get(event.beatId);
    if (count === undefined) {
      return [unknownReference(['timing', 'events', i, 'beatId'], 'beat', event.beatId)];
    }
    return event.eventIndex < count
      ? []
      : [
          unknownReference(
            ['timing', 'events', i, 'eventIndex'],
            'event index',
            String(event.eventIndex),
          ),
        ];
  });
}
