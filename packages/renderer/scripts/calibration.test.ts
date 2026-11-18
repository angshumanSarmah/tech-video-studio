import { describe, expect, it } from 'vitest';
import {
  calibrationPaths,
  centreCrop,
  describeCrop,
  parsePlatform,
  pngSize,
  remotionStillArgs,
} from './calibration.ts';

function fakePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('calibration script helpers', () => {
  it('accepts only known platforms', () => {
    expect(parsePlatform('shorts')).toBe('shorts');
    expect(parsePlatform('reels')).toBe('reels');
    expect(() => parsePlatform('tiktok')).toThrow(/Usage: calibrate:safe-area <shorts\|reels>/);
    expect(() => parsePlatform(undefined)).toThrow(/Got: \(nothing\)/);
  });

  it('maps a platform to its gitignored screenshot and check image', () => {
    expect(calibrationPaths('reels')).toEqual({
      screenshot: 'calibration/reels.png',
      output: '../../docs/safe-area/reels-check.png',
    });
  });

  it('reads PNG dimensions and rejects other files', () => {
    expect(pngSize(fakePng(1080, 1920))).toEqual({ width: 1080, height: 1920 });
    expect(() => pngSize(new Uint8Array(24))).toThrow(/Not a PNG/);
  });

  const canvas = { width: 1080, height: 1920 };

  it('keeps a 9:16 screenshot whole', () => {
    const crop = centreCrop({ width: 720, height: 1280 }, canvas);
    expect(crop).toEqual({
      x: 0,
      y: 0,
      width: 720,
      height: 1280,
      sourceWidth: 720,
      sourceHeight: 1280,
    });
    expect(describeCrop(crop)).toBe('Screenshot 720x1280 is already 9:16; no crop.');
  });

  it('crops a taller screenshot top and bottom, keeping its full width', () => {
    const crop = centreCrop({ width: 1179, height: 2556 }, canvas);
    expect(crop).toMatchObject({ x: 0, y: 230, width: 1179, height: 2096 });
    expect(describeCrop(crop)).toBe('Cropped screenshot 1179x2556 to 1179x2096 at (0,230).');
  });

  it('crops a wider screenshot left and right, keeping its full height', () => {
    expect(centreCrop({ width: 1080, height: 1080 }, canvas)).toMatchObject({
      x: 236,
      y: 0,
      width: 608,
      height: 1080,
    });
  });

  it('never rounds the crop past the screenshot edges', () => {
    // 1170 / (9/16) = 2080, one pixel more than the screenshot has.
    expect(centreCrop({ width: 1170, height: 2079 }, canvas)).toMatchObject({
      width: 1169,
      height: 2079,
    });
  });

  it('passes platform, screenshot and crop to the still as props', () => {
    const crop = centreCrop({ width: 1179, height: 2556 }, canvas);
    const args = remotionStillArgs('shorts', crop);
    expect(args.slice(0, 4)).toEqual([
      'still',
      'src/entry.ts',
      'SafeAreaCalibration',
      '../../docs/safe-area/shorts-check.png',
    ]);
    const props = JSON.parse(args[4]?.replace('--props=', '') ?? '') as unknown;
    expect(props).toEqual({ platform: 'shorts', screenshot: 'calibration/shorts.png', crop });
  });
});
