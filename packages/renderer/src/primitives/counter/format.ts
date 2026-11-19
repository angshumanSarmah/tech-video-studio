/**
 * Formats a counter value for the screen. The locale comes from the theme (`numberLocale`), so
 * `en-IN` groups as 1,00,000 and `en-US` as 100,000.
 */
export function formatCount(value: number, locale: string, decimals = 0): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * The number a counter shows. Without a `count` event (`countProgress` undefined) it shows `value`.
 * With one, it shows `from` (default 0) from the start, then counts to `value` once the count
 * begins (`countProgress` 0 until then).
 */
export function counterValue(
  props: { value: number; from?: number | undefined; decimals: number },
  countProgress: number | undefined,
): number {
  if (countProgress === undefined) return props.value;
  return countValueAt(props.from ?? 0, props.value, countProgress, props.decimals);
}

/** Value shown at `progress` (0..1) of a count from `from` to `to`, rounded to `decimals`. */
export function countValueAt(from: number, to: number, progress: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round((from + (to - from) * progress) * factor) / factor;
}

/**
 * Linear progress of a `ticking` count: seconds since `count` (`ElementState.elapsed.count`) over
 * the seconds the count runs (`ElementState.runSec.count`: until the `reject`, else the `exit` or
 * the end of its beat), so the count reaches its value exactly then. Undefined without a `count`
 * event; 1 for a count with no time to run.
 */
export function tickProgress(
  elapsedSec: number | undefined,
  runSec: number | undefined,
): number | undefined {
  if (elapsedSec === undefined) return undefined;
  if (runSec === undefined || runSec <= 0) return 1;
  return Math.min(1, elapsedSec / runSec);
}
