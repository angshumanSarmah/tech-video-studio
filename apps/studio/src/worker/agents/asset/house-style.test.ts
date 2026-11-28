import { describe, expect, it } from 'vitest';
import { drafterSections, houseStyleText } from './house-style.ts';

describe('drafterSections', () => {
  it('joins every marked span in order and leaves the rest out', () => {
    const doc = [
      '# Title',
      'intro, mentioning `<!-- drafter -->` inline',
      '<!-- drafter -->',
      '## A',
      'rule a',
      '<!-- /drafter -->',
      '## Not this',
      '<!-- drafter -->',
      '## B',
      '<!-- /drafter -->',
    ].join('\n');
    expect(drafterSections(doc)).toBe('## A\nrule a\n\n## B');
  });

  it('refuses a doc with no marked span', () => {
    expect(() => drafterSections('# Nothing')).toThrow(/no <!-- drafter --> section/);
  });

  it('reads the drawing rules of docs/asset-style.md, not its sanitizer or metadata notes', () => {
    const text = houseStyleText();
    for (const heading of ['## File format', '## Stroke', '## Palette tokens', '## Drawing']) {
      expect(text).toContain(heading);
    }
    expect(text).not.toMatch(/What the sanitizer does|## Metadata|## Logo slots/);
  });
});
