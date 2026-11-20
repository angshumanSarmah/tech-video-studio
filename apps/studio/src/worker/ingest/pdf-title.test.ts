import { describe, expect, it } from 'vitest';
import { largestTextTitle, PDF_TITLE_MAX_CHARS, type SizedText } from './pdf-title.ts';

const item = (str: string, fontSize: number, hasEOL = false): SizedText => ({
  str,
  fontSize,
  hasEOL,
});

describe('largestTextTitle', () => {
  it('joins the first run of adjacent items in the largest size, across line ends', () => {
    const items = [
      item('Preprint, not peer reviewed', 9, true),
      item('Consistent', 22),
      item(' ', 11),
      item('Hashing', 22.2, true),
      item('Field Notes', 21.9, true),
      item('A hash ring maps keys onto a circle.', 11, true),
      item('Appendix', 22, true),
    ];
    expect(largestTextTitle(items)).toBe('Consistent Hashing Field Notes');
  });

  it('is null for a page without text, or when the largest text is too short', () => {
    expect(largestTextTitle([])).toBeNull();
    expect(largestTextTitle([item('  ', 30, true)])).toBeNull();
    expect(largestTextTitle([item('7', 40, true), item('Body text here.', 11)])).toBeNull();
  });

  it('cuts a long run at a word, with an ellipsis', () => {
    const title = largestTextTitle([item('word '.repeat(60), 20)])!;
    expect(title.length).toBeLessThanOrEqual(PDF_TITLE_MAX_CHARS);
    expect(title.endsWith('word…')).toBe(true);
  });
});
