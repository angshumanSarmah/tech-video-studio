import { describe, expect, it } from 'vitest';
import {
  aspectWarning,
  calibrationPaths,
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

  it('warns only when the screenshot is not 9:16', () => {
    const canvas = { width: 1080, height: 1920 };
    expect(aspectWarning({ width: 720, height: 1280 }, canvas)).toBeNull();
    expect(aspectWarning({ width: 1179, height: 2556 }, canvas)).toMatch(/stretched/);
  });

  it('passes platform and screenshot to the still as props', () => {
    const args = remotionStillArgs('shorts');
    expect(args.slice(0, 4)).toEqual([
      'still',
      'src/entry.ts',
      'SafeAreaCalibration',
      '../../docs/safe-area/shorts-check.png',
    ]);
    const props = JSON.parse(args[4]?.replace('--props=', '') ?? '') as unknown;
    expect(props).toEqual({ platform: 'shorts', screenshot: 'calibration/shorts.png' });
  });
});
