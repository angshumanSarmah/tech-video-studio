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

/** Value shown at `progress` (0..1) of a count from `from` to `to`, rounded to `decimals`. */
export function countValueAt(from: number, to: number, progress: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round((from + (to - from) * progress) * factor) / factor;
}
