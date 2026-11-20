import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSubtitleCues, type SubtitleCue } from '@explainer-studio/renderer/catalog';
import { fixtureSeries, rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import { DEFAULT_THEME_ID, getTheme } from '@explainer-studio/renderer/theme';
import {
  DEFAULT_PRONUNCIATIONS,
  effectiveTiming,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createKokoroClient } from '../tts/kokoro-client.ts';
import { createKokoroProvider } from '../tts/kokoro-provider.ts';
import type { TtsProvider } from '../tts/provider.ts';
import { fakeServer } from '../tts/testing/fake-server.ts';
import { formatSrt, srtTimestamp, targetSubtitleCues } from './srt.ts';
import type { RenderTarget } from './target.ts';

function target(spec: RenderableVideoSpec, themeId?: string): RenderTarget {
  return {
    spec,
    props: { series: fixtureSeries, channelHandle: null, ...(themeId ? { themeId } : {}) },
    audioPath: null,
  };
}

/** A strict SubRip reader: what a player or YouTube's importer requires. */
function parseSrt(text: string) {
  const timestamp = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/;
  const toSec = (stamp: string) => {
    const m = timestamp.exec(stamp);
    if (!m) throw new Error(`bad timestamp ${stamp}`);
    const [h, min, s, ms] = m.slice(1).map(Number) as [number, number, number, number];
    return h * 3600 + min * 60 + s + ms / 1000;
  };
  expect(text.endsWith('\n')).toBe(true);
  return text
    .trimEnd()
    .split('\n\n')
    .map((block, i) => {
      const [index, times, ...lines] = block.split('\n');
      expect(index).toBe(String(i + 1));
      const [start, end, ...rest] = (times ?? '').split(' --> ');
      expect(rest).toEqual([]);
      expect(lines).toHaveLength(1);
      return { startSec: toSec(start!), endSec: toSec(end!), text: lines[0]! };
    });
}

describe('srtTimestamp', () => {
  it.each([
    [0, '00:00:00,000'],
    [1.2345, '00:00:01,235'],
    [59.9996, '00:01:00,000'],
    [3725.04, '01:02:05,040'],
  ])('%s s → %s', (sec, stamp) => {
    expect(srtTimestamp(sec)).toBe(stamp);
  });
});

describe('formatSrt', () => {
  const cue = (text: string, startSec: number, endSec: number): SubtitleCue => ({
    beatId: 'hook',
    startSec,
    endSec,
    text,
    words: [],
    width: 0,
    scale: 1,
  });

  it('writes numbered blocks with a blank line between them', () => {
    const srt = formatSrt([cue('One client', 0, 0.8), cue('sends ten thousand', 0.8, 2.25)]);
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:00,800\nOne client\n\n' +
        '2\n00:00:00,800 --> 00:00:02,250\nsends ten thousand\n',
    );
  });

  it('is empty without cues', () => {
    expect(formatSrt([])).toBe('');
  });
});

describe('the SRT of a video', () => {
  it.each([DEFAULT_THEME_ID, 'blueprint-dark'])(
    'validates and holds exactly the cues the video draws (%s)',
    (themeId) => {
      const t = target(rateLimiterSpec, themeId);
      const cues = buildSubtitleCues(rateLimiterSpec, getTheme(themeId));
      const parsed = parseSrt(formatSrt(targetSubtitleCues(t)));

      expect(parsed.map((c) => c.text)).toEqual(cues.map((c) => c.text));
      parsed.forEach((block, i) => {
        expect(block.startSec).toBeCloseTo(cues[i]!.startSec, 3);
        expect(block.endSec).toBeCloseTo(cues[i]!.endSec, 3);
        expect(block.endSec).toBeGreaterThan(block.startSec);
        const next = parsed[i + 1];
        if (next) expect(block.endSec).toBeLessThanOrEqual(next.startSec);
      });
    },
  );

  it("matches the audio: each block runs from its first word's start past its last word's end", () => {
    const words = effectiveTiming(rateLimiterSpec).beats.flatMap((b) => b.words);
    const parsed = parseSrt(formatSrt(targetSubtitleCues(target(rateLimiterSpec))));
    let cursor = 0;
    for (const block of parsed) {
      const count = block.text.split(' ').length;
      const first = words[cursor]!;
      const last = words[cursor + count - 1]!;
      expect(block.startSec).toBeCloseTo(first.startSec, 3);
      expect(block.endSec).toBeGreaterThanOrEqual(Math.round(last.endSec * 1000) / 1000);
      cursor += count;
    }
    expect(cursor).toBe(words.length);
  });
});

describe('subtitles after TTS with respellings', () => {
  let provider: TtsProvider | undefined;
  afterEach(async () => {
    await provider?.close();
    provider = undefined;
  });

  it('show the narration words, never the pronunciation respellings', async () => {
    const identity = {
      packages: { kokoro: '0.9.4' },
      revision: 'rev1',
      files: { 'kokoro-v1_0.pth': 'w1', 'voices/af_heart.pt': 'v1' },
    };
    provider = createKokoroProvider({
      dataDir: mkdtempSync(join(tmpdir(), 'srt-tts-')),
      client: createKokoroClient({ spawn: fakeServer('ok', identity).spawn }),
      identity,
      pronunciations: () => DEFAULT_PRONUNCIATIONS,
    });
    const narration = 'The JSON body hits Redis over gRPC.';
    const { words, durationSec } = await provider.synthesize(narration, 'af_heart', 1);
    const [first] = rateLimiterSpec.script;
    const spec: RenderableVideoSpec = {
      ...rateLimiterSpec,
      script: [{ ...first!, narration }],
      scenes: rateLimiterSpec.scenes.slice(0, 1),
      timing: {
        audioFile: 'narration.wav',
        beats: [{ beatId: first!.beatId, startSec: 0, endSec: durationSec, words }],
        events: [],
      },
    };

    const cues = targetSubtitleCues(target(spec));
    const srt = formatSrt(cues);
    const shown = cues.flatMap((c) => c.words.map((w) => w.text)).join(' ');
    expect(shown).toBe(narration);
    expect(
      parseSrt(srt)
        .map((c) => c.text)
        .join(' '),
    ).toBe(narration);
    for (const respelling of ['jay-son', 'reddis', 'G R P C']) {
      expect(srt.toLowerCase()).not.toContain(respelling.toLowerCase());
    }
  });
});
