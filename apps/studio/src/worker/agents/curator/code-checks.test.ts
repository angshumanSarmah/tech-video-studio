import { curatorCodeChecks, type CuratorCheckContext } from '@explainer-studio/renderer/catalog';
import { getTheme } from '@explainer-studio/renderer/theme';
import {
  DEFAULT_VIDEO_SETTINGS,
  type RenderableVideoSpec,
  type CodeIssue,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { FIXTURE_WORDS_PER_SEC, fixtureTopic, type FixtureTopicId } from '../fixture-topics.ts';
import { fixtureGeneratedSpec, recordedNotes } from '../generator/testing.ts';

/**
 * The Curator's code checks (P1C.8 step 1-3) on the two recorded fixture topics: the recorded
 * plan, script and boards, timed with the committed Kokoro timing at the default pauses, as the
 * re-timed spec after the Generator. Each finding here is a real one in the recordings.
 */

const SERIES = {
  'rate-limiter': { name: 'System Design', label: 'SYSTEM DESIGN' },
  tokenizer: { name: 'AI', label: 'AI' },
} as const;

function context(topic: FixtureTopicId): CuratorCheckContext {
  return {
    theme: getTheme(),
    notes: recordedNotes(topic),
    topicTitle: fixtureTopic(topic).topic.title,
    series: SERIES[topic],
    channelHandle: null,
    // The pace the recordings were made at (`fixtureRunSettings`).
    video: { ...DEFAULT_VIDEO_SETTINGS, wordsPerSec: FIXTURE_WORDS_PER_SEC },
    pauses: { beatGapSec: 0, landingSec: 0 },
    recent: { combos: [], patterns: [] },
  };
}

const summary = (issues: readonly CodeIssue[]) =>
  issues.map((i) => `${i.severity} ${i.owner} ${i.path} ${i.code}`);

const checks = (topic: FixtureTopicId, spec: RenderableVideoSpec = fixtureGeneratedSpec(topic)) =>
  curatorCodeChecks(spec, context(topic));

describe('curatorCodeChecks on the recorded topics', () => {
  it('rate limiter: beat1 and beat7 run well over their planned seconds, nothing else', () => {
    const issues = checks('rate-limiter');
    expect(summary(issues)).toEqual([
      'blocking scriptwriter $.script[0].narration beat_over_target',
      'blocking scriptwriter $.script[6].narration beat_over_target',
    ]);
    expect(issues[0]?.message).toContain('runs 10.8 s against its planned 8 s (135%');
    expect(issues[1]?.message).toContain('runs 15.2 s against its planned 12 s (127%');
  });

  it('tokenizer: two focus-coloured elements off the focus, and the video runs long', () => {
    expect(summary(checks('tokenizer'))).toEqual([
      'advisory generator $.scenes[4].elements[4] focus_colour_off_focus',
      'advisory generator $.scenes[5].elements[4] focus_colour_off_focus',
      'advisory scriptwriter $.script video_over_target',
    ]);
  });
});

describe('curatorCodeChecks on seeded rate limiter faults', () => {
  function seeded(change: (spec: RenderableVideoSpec) => void): RenderableVideoSpec {
    const spec = structuredClone(fixtureGeneratedSpec('rate-limiter'));
    change(spec);
    return spec;
  }

  const beat = (spec: RenderableVideoSpec, id: string) => {
    const found = spec.script.find((s) => s.beatId === id);
    if (!found) throw new Error(`no beat ${id}`);
    return found;
  };

  it("hook_number_repeated: beat7 says the hook's thirty-one percent again", () => {
    const spec = seeded((s) => {
      // An earlier recording's last line; untimed, as the narration no longer matches the audio.
      delete s.timing;
      const fail = beat(s, 'beat7');
      fail.narration = fail.narration.replace(
        'Checkouts started failing.',
        'Thirty-one percent of checkouts failed.',
      );
    });
    expect(summary(checks('rate-limiter', spec))).toContain(
      'blocking scriptwriter $.script[6].narration hook_number_repeated',
    );
  });

  it('source_missing_on_screen: beat5 shows the measured round trips without its source', () => {
    const spec = seeded((s) => {
      delete beat(s, 'beat5').source;
      // Not an example beat (an example gets the EXAMPLE stamp and needs no source).
      const story = s.story.beats.find((b) => b.id === 'beat5');
      if (story) story.exampleNumbers = false;
    });
    expect(summary(checks('rate-limiter', spec))).toContain(
      'blocking scriptwriter $.script[4].source source_missing_on_screen',
    );
  });

  it('ok_element_rejected: a store drawn ok that the beat rejects', () => {
    const spec = seeded((s) => {
      const store = s.scenes[5]?.elements.find((e) => e.id === 'check_card');
      if (store) store.props.semantic = 'ok';
    });
    expect(summary(checks('rate-limiter', spec))).toContain(
      'advisory generator $.scenes[5].events[7] ok_element_rejected',
    );
  });

  it('validation errors block, and nothing else runs on an invalid spec', () => {
    const spec = seeded((s) => {
      const first = s.scenes[0]?.events[0];
      if (first) first.at = { type: 'word', index: 999 };
    });
    expect(summary(checks('rate-limiter', spec))).toEqual([
      'blocking generator $.scenes[0].events[0].at anchor_out_of_range',
    ]);
  });
});
