import { writeFileSync } from 'node:fs';
import { CATALOGUE_FILES } from './catalogue-files.ts';

for (const file of CATALOGUE_FILES) {
  writeFileSync(file.path, file.build());
  console.log(`Wrote ${file.path}`);
}
