import { describe, expect, it } from 'vitest';
import { sourceQuality, THIN_SOURCE_CHARS, thinSourceMessage } from './source-quality.ts';

const paragraph = (n: number) =>
  `A queue holds work until a worker is free; the oldest item goes first, so waiting time grows with the backlog (${n}).`;

describe('sourceQuality', () => {
  it('drops link lines, link labels and boilerplate from what counts', () => {
    const text = [
      'Feb 14, 2023',
      'Why is the store quick? There are 3 main reasons as shown in the diagram below.',
      'If you enjoyed this post, you might like our handbooks as well.',
      'Book-one: https://shop.example.com/b/1',
      'https://shop.example.com/b/2',
      'Subscribe to get the next post.',
    ].join('\n\n');
    const q = sourceQuality(text);
    expect(q.substantiveChars).toBe('Feb 14, 2023'.length + 79);
    expect(q.thin).toEqual(['points_at_image', 'mostly_boilerplate']);
  });

  it('a long article is not thin; a long page of furniture is', () => {
    const article = Array.from({ length: 20 }, (_, i) => paragraph(i)).join('\n\n');
    expect(sourceQuality(article)).toMatchObject({ thin: [], pointsAtImage: false });
    expect(sourceQuality(article).substantiveChars).toBeGreaterThan(THIN_SOURCE_CHARS);
    const links = Array.from({ length: 60 }, (_, i) => `Part ${i}: https://example.com/${i}`);
    const furniture = [...links, ...Array.from({ length: 12 }, (_, i) => paragraph(i))].join('\n');
    expect(sourceQuality(furniture).thin).toEqual(['mostly_boilerplate']);
  });

  it('a short plain source is thin because it is short', () => {
    expect(sourceQuality(paragraph(1)).thin).toEqual(['short']);
  });

  it('says what it gave, why, and what to do', () => {
    const q = sourceQuality(`${paragraph(1)}\nSee the chart below.`);
    expect(thinSourceMessage('https://notes.example.com/p/1', q)).toBe(
      `https://notes.example.com/p/1 gave only ${q.substantiveChars} characters of content ` +
        `(${q.chars} extracted): its text points at a diagram or image it does not contain. To ` +
        'use what it says, paste its text, or describe the diagram, as a source instead.',
    );
  });
});
