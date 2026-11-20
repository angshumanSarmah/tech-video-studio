import { SOURCE_TITLE_MAX } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { cleanTitle, normalizeText } from './normalize.ts';

describe('normalizeText', () => {
  it('canonicalises line ends, spaces and blank lines', () => {
    const raw = '  \r\nTitle\r\n\r\n\r\n\r\nOne two   three \t\n    indented  line  \n';
    expect(normalizeText(raw)).toBe('Title\n\nOne two three\n    indented line');
  });

  it('removes invisible and control characters that could hide text', () => {
    const raw = 'wr​ite⁠-ahead﻿ log\u0007 with ‮bidi‬ and tags󠁁';
    expect(normalizeText(raw)).toBe('write-ahead log with bidi and tags');
  });

  it('composes to NFC so the same text hashes the same', () => {
    expect(normalizeText('café')).toBe('café');
  });
});

describe('cleanTitle', () => {
  it('flattens to one line and drops empty titles', () => {
    expect(cleanTitle('  A\n  title ')).toBe('A title');
    expect(cleanTitle('   ')).toBeNull();
    expect(cleanTitle(null)).toBeNull();
  });

  it('cuts long titles at a word with an ellipsis', () => {
    const long = 'word '.repeat(80);
    const title = cleanTitle(long)!;
    expect(title.length).toBeLessThanOrEqual(SOURCE_TITLE_MAX);
    expect(title.endsWith('word…')).toBe(true);
  });
});
