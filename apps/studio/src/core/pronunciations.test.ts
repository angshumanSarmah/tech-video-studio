import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PRONUNCIATIONS } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { ConfigError } from './config.ts';
import { readPronunciations } from './pronunciations.ts';

function dataDirWith(text?: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), 'pronunciations-'));
  if (text !== undefined) {
    mkdirSync(join(dataDir, 'config'));
    writeFileSync(join(dataDir, 'config', 'pronunciations.json'), text);
  }
  return dataDir;
}

describe('readPronunciations', () => {
  it('returns the defaults when the file does not exist', () => {
    expect(readPronunciations(dataDirWith())).toEqual(DEFAULT_PRONUNCIATIONS);
  });

  it('reads the file instead of the defaults', () => {
    expect(readPronunciations(dataDirWith('{ "Kafka": "kaf-ka" }'))).toEqual({ Kafka: 'kaf-ka' });
  });

  it('names the file for invalid JSON or entries', () => {
    expect(() => readPronunciations(dataDirWith('{'))).toThrow(ConfigError);
    expect(() => readPronunciations(dataDirWith('{ "two words": "x" }'))).toThrow(
      /pronunciations\.json/,
    );
  });
});
