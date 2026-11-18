import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_FILES } from './catalogue-files.ts';

describe('generated catalogue files', () => {
  it.each(CATALOGUE_FILES.map((f) => [f.path, f] as const))(
    '%s is up to date (run `pnpm --filter @explainer-studio/renderer gen:catalogue`)',
    (_path, file) => {
      expect(readFileSync(file.path, 'utf8')).toBe(file.build());
    },
  );
});
