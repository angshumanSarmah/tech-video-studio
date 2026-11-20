import { describe, expect, it } from 'vitest';
import { urlFallbackTitle } from './ingest-source.ts';

describe('urlFallbackTitle', () => {
  const title = (url: string, format: Parameters<typeof urlFallbackTitle>[1]) =>
    urlFallbackTitle(new URL(url), format);

  it('uses a PDF’s file name, dropping only a .pdf extension', () => {
    expect(title('https://papers.example.com/pdf/ring%20notes.PDF?dl=1', 'pdf')).toBe('ring notes');
    expect(title('https://arxiv.example.org/pdf/1706.03762', 'pdf')).toBe('1706.03762');
  });

  it('uses host and path for other formats, or a PDF at the site root', () => {
    expect(title('https://notes.example.com/posts/wal', 'html')).toBe(
      'notes.example.com/posts/wal',
    );
    expect(title('https://notes.example.com/', 'pdf')).toBe('notes.example.com');
  });
});
