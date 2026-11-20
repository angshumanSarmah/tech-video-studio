import { describe, expect, it } from 'vitest';
import {
  compareSilences,
  parseProbe,
  readMonoPcm,
  silentIntervals,
  synthNarration,
} from './media-checks.ts';

const beats = [
  { startSec: 0, endSec: 1 },
  { startSec: 1.15, endSec: 2 },
  { startSec: 2.15, endSec: 3 },
];

describe('synthNarration / silentIntervals', () => {
  it('finds the gaps between beats', () => {
    const { samples, sampleRate } = readMonoPcm(synthNarration(beats, 8000));
    const silences = silentIntervals(samples, sampleRate);
    expect(silences).toHaveLength(2);
    expect(silences[0]!.startSec).toBeCloseTo(1, 1);
    expect(silences[0]!.endSec).toBeCloseTo(1.15, 1);
  });
});

describe('compareSilences', () => {
  const expected = [
    { startSec: 1, endSec: 1.15 },
    { startSec: 3, endSec: 3.5 },
  ];

  it('accepts small edge shifts and a longer final silence (the padded tail)', () => {
    const actual = [
      { startSec: 1.01, endSec: 1.16 },
      { startSec: 3.0, endSec: 4.2 },
    ];
    expect(compareSilences(expected, actual)).toMatchObject({ ok: true });
  });

  it('rejects a shifted silence or a new gap', () => {
    const shifted = [
      { startSec: 1.2, endSec: 1.35 },
      { startSec: 3, endSec: 3.5 },
    ];
    expect(compareSilences(expected, shifted).ok).toBe(false);
    const extra = [...expected, { startSec: 2, endSec: 2.2 }];
    expect(compareSilences(expected, extra)).toMatchObject({ ok: false });
  });
});

describe('parseProbe', () => {
  it('reads the video and audio stream facts', () => {
    const json = JSON.stringify({
      format: { duration: '61.500000' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1080,
          height: 1920,
          pix_fmt: 'yuv420p',
          r_frame_rate: '30/1',
          nb_frames: '1845',
        },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000' },
      ],
    });
    expect(parseProbe(json)).toEqual({
      durationSec: 61.5,
      video: {
        codec: 'h264',
        width: 1080,
        height: 1920,
        pixFmt: 'yuv420p',
        fps: '30/1',
        frames: 1845,
      },
      audio: { codec: 'aac', sampleRate: 48000 },
    });
  });
});
