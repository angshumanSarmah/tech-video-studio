import { describe, expect, it } from 'vitest';
import { concatArgs, concatListText, ffSec, muxArgs, probeArgs } from './ffmpeg-args.ts';

/** The value after `flag` (the first occurrence after `from`). */
function after(args: readonly string[], flag: string, from = 0): string | undefined {
  const i = args.indexOf(flag, from);
  return i < 0 ? undefined : args[i + 1];
}

describe('muxArgs: final MP4 contract', () => {
  const args = muxArgs({
    videoPath: '/r/final.video.mp4',
    audio: { path: '/r/narration.wav', startSec: 0 },
    durationSec: 61.5,
    outPath: '/r/out.mp4',
  });

  it('copies the H.264 yuv420p video from Remotion (never re-encodes it)', () => {
    expect(after(args, '-c:v')).toBe('copy');
    expect(args).not.toContain('-vf');
    expect(after(args, '-map')).toBe('0:v:0');
  });

  it('encodes the narration as AAC at 48 kHz', () => {
    expect(after(args, '-c:a')).toBe('aac');
    expect(after(args, '-ar')).toBe('48000');
    expect(after(args, '-map', args.indexOf('0:v:0'))).toBe('1:a:0');
  });

  it('lays the whole narration from 0 s, padded with silence to the exact video length', () => {
    expect(after(args, '-ss')).toBe('0');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('/r/narration.wav'));
    expect(after(args, '-af')).toBe('apad');
    expect(after(args, '-t')).toBe('61.5');
    expect(args).not.toContain('-shortest');
  });

  it('writes +faststart and overwrites the output', () => {
    expect(after(args, '-movflags')).toBe('+faststart');
    expect(args[0]).toBe('-y');
    expect(args.at(-1)).toBe('/r/out.mp4');
  });
});

describe('muxArgs: a beat clip', () => {
  it("seeks the narration to the clip's span start", () => {
    // A beat from frame 47 to 98 at 15 fps.
    const args = muxArgs({
      videoPath: '/r/b.video.mp4',
      audio: { path: '/r/n.wav', startSec: 47 / 15 },
      durationSec: 51 / 15,
      outPath: '/r/b.mp4',
    });
    expect(after(args, '-ss')).toBe('3.133333');
    expect(after(args, '-t')).toBe('3.4');
  });

  it('only remuxes (for +faststart) when there is no narration yet', () => {
    const args = muxArgs({ videoPath: '/v.mp4', audio: null, durationSec: 3, outPath: '/o.mp4' });
    expect(args).toEqual([
      ...['-y', '-hide_banner', '-loglevel', 'error', '-i', '/v.mp4'],
      ...['-map', '0:v:0', '-c:v', 'copy', '-movflags', '+faststart', '/o.mp4'],
    ]);
  });
});

describe('concat', () => {
  it('lists clips in order, escaping single quotes', () => {
    expect(concatListText(['/a/hook.mp4', "/a/it's.mp4"])).toBe(
      "file '/a/hook.mp4'\nfile '/a/it'\\''s.mp4'\n",
    );
  });

  it('copies the video streams only (clip audio slices are dropped)', () => {
    const args = concatArgs('/a/list.txt', '/a/out.mp4');
    expect(after(args, '-f')).toBe('concat');
    expect(after(args, '-safe')).toBe('0');
    expect(after(args, '-map')).toBe('0:v:0');
    expect(after(args, '-c')).toBe('copy');
  });
});

describe('ffSec / probeArgs', () => {
  it('prints seconds without float noise', () => {
    expect(ffSec(0.1 + 0.2)).toBe('0.3');
    expect(ffSec(12)).toBe('12');
  });

  it('asks ffprobe for the stream facts the benchmark checks', () => {
    const entries = after(probeArgs('/x.mp4'), '-show_entries');
    expect(entries).toContain('format=duration');
    expect(entries).toContain('pix_fmt');
    expect(entries).toContain('sample_rate');
  });
});
