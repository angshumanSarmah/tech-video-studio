import { writeFileSync } from 'node:fs';
import { expectedThemeCss, GENERATED_CSS_PATH } from './theme-css.ts';

writeFileSync(GENERATED_CSS_PATH, expectedThemeCss());
console.log(`Wrote ${GENERATED_CSS_PATH}`);
