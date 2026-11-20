import type { ModelPrice, OffPeak } from '@explainer-studio/shared';
import type { TokenUsage } from './types.ts';

const TOKENS_PER_PRICE_UNIT = 1_000_000;

/** `HH:MM` (validated by `UtcWindowSchema`; `24:00` = end of day) as minutes since midnight. */
function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** ISO weekday in UTC: 1 = Monday … 7 = Sunday. */
function isoWeekdayUtc(at: Date): number {
  return at.getUTCDay() === 0 ? 7 : at.getUTCDay();
}

/** Peak = a listed weekday inside one of the half-open `[start, end)` windows; all else is off-peak. */
export function isOffPeak(at: Date, offPeak: OffPeak): boolean {
  if (!offPeak.peakDaysUtc.includes(isoWeekdayUtc(at))) return true;
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  const inPeak = offPeak.peakWindowsUtc.some(
    (w) => minute >= minutesOf(w.start) && minute < minutesOf(w.end),
  );
  return !inPeak;
}

/**
 * USD for one call: cache-hit input, cache-miss input and output (reasoning included) at the
 * model's prices, times the off-peak multiplier when `at` (the request start) is off-peak.
 */
export function callCostUsd(usage: TokenUsage, price: ModelPrice, at: Date): number {
  const peakCost =
    (usage.inCached * price.inputCacheHitPerMTok +
      usage.inUncached * price.inputCacheMissPerMTok +
      usage.out * price.outputPerMTok) /
    TOKENS_PER_PRICE_UNIT;
  const multiplier = price.offPeak && isOffPeak(at, price.offPeak) ? price.offPeak.multiplier : 1;
  return peakCost * multiplier;
}
