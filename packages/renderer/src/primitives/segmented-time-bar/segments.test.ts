import { describe, expect, it } from 'vitest';
import { getTheme } from '../../theme/index.ts';
import { segmentedTimeBarPrimitive, SegmentedTimeBarPropsSchema } from './definition.ts';
import { segmentFills, segmentStarts, segmentWidths, timeToX } from './segments.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('segmentWidths', () => {
  it('is proportional when every segment clears its minimum', () => {
    expect(segmentWidths([1, 3], [10, 10], 400)).toEqual([100, 300]);
  });

  it('pins short segments at their minimum and shares the rest', () => {
    const widths = segmentWidths([1, 50, 49], [80, 10, 10], 500);
    expect(widths[0]).toBe(80);
    expect(sum(widths)).toBeCloseTo(500);
    expect((widths[1] ?? 0) / (widths[2] ?? 1)).toBeCloseTo(50 / 49);
  });

  it('falls back to the minimums when they do not fit', () => {
    expect(segmentWidths([1, 1], [300, 300], 400)).toEqual([300, 300]);
  });
});

describe('timeToX', () => {
  it('maps seconds into the segment that holds them', () => {
    const values = [60, 150];
    const widths = [200, 300];
    expect(timeToX(0, values, widths)).toBe(0);
    expect(timeToX(30, values, widths)).toBe(100);
    expect(timeToX(60 + 75, values, widths)).toBe(350);
    expect(timeToX(999, values, widths)).toBe(500);
  });
});

describe('segmentStarts', () => {
  it('starts each segment where the previous one ends', () => {
    expect(segmentStarts([200, 300, 50])).toEqual([0, 200, 500]);
  });
});

describe('segmentFills', () => {
  it('is full without enter, and fills left to right after it', () => {
    expect(segmentFills(3, undefined)).toEqual([1, 1, 1]);
    expect(segmentFills(3, 0)).toEqual([0, 0, 0]);
    const mid = segmentFills(3, 0.5);
    expect(mid[0]).toBe(1);
    expect(mid[1]).toBeGreaterThan(0);
    expect(mid[2]).toBe(0);
    expect(segmentFills(3, 10)).toEqual([1, 1, 1]);
  });

  it('fills many segments within a capped time', () => {
    expect(segmentFills(5, 1.5)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('segmented_time_bar', () => {
  it('fits five segments with long labels inside the stage', () => {
    const segments = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      label: 'DELIVERY',
      sec: 30,
    }));
    const hints = segmentedTimeBarPrimitive.sizeHints(
      SegmentedTimeBarPropsSchema.parse({ segments, budgetSec: 120 }),
      getTheme(),
    );
    expect(hints.preferredWidth).toBeLessThanOrEqual(936);
  });
});
