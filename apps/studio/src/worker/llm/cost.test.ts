import { defaultPriceTable, DEEPSEEK_MODELS, type ModelPrice } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { callCostUsd, isOffPeak } from './cost.ts';

const flash = defaultPriceTable()[DEEPSEEK_MODELS.v41Flash]!;
const offPeak = flash.offPeak!;

// 2026-11-16 is a Monday; 2026-11-21 a Saturday.
const utc = (iso: string) => new Date(`${iso}Z`);

describe('isOffPeak', () => {
  it.each([
    ['2026-11-16T00:59:59', true],
    ['2026-11-16T01:00:00', false],
    ['2026-11-16T03:59:59', false],
    ['2026-11-16T04:00:00', true],
    ['2026-11-16T05:30:00', true],
    ['2026-11-16T06:00:00', false],
    ['2026-11-16T09:59:00', false],
    ['2026-11-16T10:00:00', true],
    ['2026-11-20T02:00:00', false],
    ['2026-11-21T02:00:00', true],
    ['2026-11-22T07:00:00', true],
  ])('%s UTC → off-peak %s', (iso, expected) => {
    expect(isOffPeak(utc(iso), offPeak)).toBe(expected);
  });

  it('treats 24:00 as the end of the day', () => {
    const allDay = {
      multiplier: 0.5,
      peakDaysUtc: [1],
      peakWindowsUtc: [{ start: '00:00', end: '24:00' }],
    };
    expect(isOffPeak(utc('2026-11-16T23:59:00'), allDay)).toBe(false);
    expect(isOffPeak(utc('2026-11-17T00:00:00'), allDay)).toBe(true);
  });
});

describe('callCostUsd', () => {
  const price: ModelPrice = {
    inputCacheHitPerMTok: 0.1,
    inputCacheMissPerMTok: 1,
    outputPerMTok: 2,
    offPeak,
  };
  const usage = { inCached: 800_000, inUncached: 200_000, out: 500_000, reasoning: 300_000 };
  const peak = utc('2026-11-16T02:00:00');

  it('prices cache hits, misses and output (reasoning included) per million tokens', () => {
    // 0.8 × 0.1 + 0.2 × 1 + 0.5 × 2 = 0.08 + 0.2 + 1
    expect(callCostUsd(usage, price, peak)).toBeCloseTo(1.28, 10);
  });

  it('applies the off-peak multiplier inside the off-peak window', () => {
    expect(callCostUsd(usage, price, utc('2026-11-16T05:00:00'))).toBeCloseTo(0.64, 10);
  });

  it('never discounts a model without an off-peak rule', () => {
    const flat: ModelPrice = {
      inputCacheHitPerMTok: 0.1,
      inputCacheMissPerMTok: 1,
      outputPerMTok: 2,
    };
    expect(callCostUsd(usage, flat, utc('2026-11-21T05:00:00'))).toBeCloseTo(1.28, 10);
  });

  it('matches the default flash prices', () => {
    const one = { inCached: 1_000_000, inUncached: 1_000_000, out: 1_000_000, reasoning: 0 };
    expect(callCostUsd(one, flash, peak)).toBeCloseTo(0.006 + 0.3 + 1.2, 10);
  });
});
