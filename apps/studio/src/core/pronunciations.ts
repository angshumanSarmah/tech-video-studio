import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PRONUNCIATIONS,
  PronunciationsSchema,
  type Pronunciations,
} from '@explainer-studio/shared';
import { z } from 'zod';
import { ConfigError } from './config.ts';
import { pronunciationsPath } from './data-files.ts';

/**
 * Reads `<dataDir>/config/pronunciations.json`. A missing file yields `DEFAULT_PRONUNCIATIONS`;
 * an invalid one throws a `ConfigError` naming the file. Never writes.
 */
export function readPronunciations(dataDir: string): Pronunciations {
  const path = join(dataDir, pronunciationsPath());
  if (!existsSync(path)) return DEFAULT_PRONUNCIATIONS;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const result = PronunciationsSchema.safeParse(json);
  if (result.success) return result.data;
  throw new ConfigError(`Invalid pronunciations in ${path}:\n${z.prettifyError(result.error)}`);
}
