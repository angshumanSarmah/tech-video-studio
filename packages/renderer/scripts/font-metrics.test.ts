import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFontMetrics, FONT_METRICS_PATH } from './font-metrics.ts';

describe('generated font metrics', () => {
  it('are up to date (run `pnpm --filter @explainer-studio/renderer gen:font-metrics`)', () => {
    expect(readFileSync(FONT_METRICS_PATH, 'utf8')).toBe(buildFontMetrics());
  });
});
