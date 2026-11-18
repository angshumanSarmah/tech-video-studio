import { fileURLToPath } from 'node:url';
import { catalogueJson, catalogueMarkdown } from '../src/catalog/index.ts';

/** Generated catalogue files, compared byte-for-byte by `catalogue-files.test.ts`. */
export const CATALOGUE_FILES = [
  {
    path: fileURLToPath(new URL('../../../docs/catalogue.md', import.meta.url)),
    build: () => catalogueMarkdown(),
  },
  {
    path: fileURLToPath(new URL('../../../docs/catalogue.json', import.meta.url)),
    build: () => catalogueJson(),
  },
] as const;
