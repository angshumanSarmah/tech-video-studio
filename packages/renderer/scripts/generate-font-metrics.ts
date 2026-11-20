import { writeFileSync } from 'node:fs';
import { buildFontMetrics, FONT_METRICS_PATH } from './font-metrics.ts';

/** Usage: pnpm --filter @explainer-studio/renderer gen:font-metrics */
writeFileSync(FONT_METRICS_PATH, buildFontMetrics());
console.log(`Wrote ${FONT_METRICS_PATH}`);
