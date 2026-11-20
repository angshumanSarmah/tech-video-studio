import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SourceIngestError } from './errors.ts';
import { detectFormat, extractDocument, uploadFormat } from './extract.ts';
import { buildPdf } from './fixtures/pdf-builder.ts';
import { decodeHtml, extractHtml } from './html.ts';
import { normalizeText } from './normalize.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const URL_ = 'https://notes.example.com/posts/wal';
const HIDDEN_MARKERS = Array.from({ length: 12 }, (_, i) => `HIDDEN-${i + 1}`);

function htmlText(): { title: string | null; text: string } {
  const doc = extractHtml(decodeHtml(fixture('wal-article.html'), 'text/html'), URL_);
  return { title: doc.title, text: normalizeText(doc.text) };
}

describe('HTML extraction', () => {
  it('keeps the article and drops navigation, cookie banner, related links and footer', () => {
    const { title, text } = htmlText();
    expect(title).toContain('How a write-ahead log keeps a database honest');
    expect(text).toContain(
      'every change is appended to a sequential log on disk before the change',
    );
    expect(text).toContain('The log is not a backup.');
    for (const chrome of ['Accept all', 'Subscribe', 'Related posts', 'All rights reserved']) {
      expect(text).not.toContain(chrome);
    }
    expect(text).not.toContain('SCRIPT-TEXT');
  });

  it('drops every element a browser would not show, wherever it sits', () => {
    const { text } = htmlText();
    for (const marker of HIDDEN_MARKERS) expect(text).not.toContain(marker);
    expect(text).not.toMatch(/ignore previous instructions/i);
  });

  it('keeps text that only a width-conditional, print or pseudo-element rule hides', () => {
    const { text } = htmlText();
    expect(text).toContain('KEPT-DESKTOP');
    expect(text).toContain('KEPT-PRINT');
    expect(text).toContain('KEPT-PSEUDO');
  });

  it('writes structure as text: headings, lists, code, tables; zero-width characters removed', () => {
    const { text } = htmlText();
    expect(text).toContain('## Group commit');
    expect(text).toContain('1. Find the last checkpoint record in the log.');
    expect(text).toContain('3. Undo the changes of transactions that never committed.');
    expect(text).toContain('```\nLSN 1041  BEGIN   tx=77'.replace(/ {2,}/g, ' '));
    expect(text).toContain('group commit | 48,000');
    expect(text).toContain('write-ahead log is');
    expect(text).not.toContain('​');
  });

  it('uses the whole cleaned body when there is no article', () => {
    const doc = extractHtml(
      '<html><head><title>Tiny</title></head><body><p>Short page.</p><p hidden>HIDDEN</p></body></html>',
      URL_,
    );
    expect(doc.title).toBe('Tiny');
    expect(doc.text).toContain('Short page.');
    expect(doc.text).not.toContain('HIDDEN');
  });

  it('decodes with the header charset, else the meta charset', () => {
    const latin1 = new Uint8Array([0x3c, 0x70, 0x3e, 0x63, 0x61, 0x66, 0xe9]); // <p>café
    expect(decodeHtml(latin1, 'text/html; charset=ISO-8859-1')).toBe('<p>café');
    const meta = new TextEncoder().encode('<meta charset="windows-1252"><p>x');
    expect(decodeHtml(meta, null)).toBe('<meta charset="windows-1252"><p>x');
  });
});

describe('markdown extraction', () => {
  it('keeps the markdown, drops HTML comments, and takes the first # heading as title', async () => {
    const doc = await extractDocument({
      bytes: fixture('tidewater-readme.md'),
      format: 'markdown',
      contentType: 'text/plain; charset=utf-8',
      url: 'https://raw.githubusercontent.com/example/tidewater/HEAD/README.md',
    });
    expect(doc.title).toBe('tidewater-queue');
    expect(doc.text).toContain('## How claiming works');
    expect(doc.text).toContain('# claim the next job (this line is code, not a heading)');
    expect(doc.text).not.toContain('HIDDEN-MD');
    expect(doc.text).not.toContain('<!--');
  });
});

describe('PDF extraction', () => {
  it('reads every page of the text layer and the Info title', async () => {
    const doc = await extractDocument({
      bytes: fixture('hashing-notes.pdf'),
      format: 'pdf',
      contentType: 'application/pdf',
      url: URL_,
    });
    expect(doc.title).toBe('Consistent Hashing Field Notes');
    const text = normalizeText(doc.text);
    expect(text).toContain('only the keys between it and its predecessor move');
    expect(text).toContain('Rebalancing is throttled to 40 MB per second');
    expect(text.indexOf('Virtual nodes')).toBeLessThan(text.indexOf('Failure handling'));
  });

  it('returns no text for a PDF without a text layer', async () => {
    const doc = await extractDocument({
      bytes: buildPdf({ pages: [[]] }),
      format: 'pdf',
      contentType: null,
      url: URL_,
    });
    expect(normalizeText(doc.text)).toBe('');
  });

  it('fails as unreadable when pdf.js cannot open the file', async () => {
    const broken = new TextEncoder().encode('%PDF-1.4\nthis is not a pdf body');
    const error = await extractDocument({
      bytes: broken,
      format: 'pdf',
      contentType: null,
      url: URL_,
    })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceIngestError);
    expect((error as SourceIngestError).code).toBe('unreadable');
  });
});

describe('detectFormat', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it('trusts PDF magic bytes over the content type', () => {
    expect(detectFormat(bytes('%PDF-1.7 …'), 'application/octet-stream', 'download')).toBe('pdf');
  });

  it('maps content types, then the file name, then sniffs HTML', () => {
    expect(detectFormat(bytes('<p>x'), 'text/html; charset=utf-8', '')).toBe('html');
    expect(detectFormat(bytes('# x'), 'text/markdown', '')).toBe('markdown');
    expect(detectFormat(bytes('# x'), 'text/plain', 'README.md')).toBe('markdown');
    expect(detectFormat(bytes('# x'), 'application/vnd.github.raw', 'README.md')).toBe('markdown');
    expect(detectFormat(bytes('plain'), 'text/plain', 'notes')).toBe('text');
    expect(detectFormat(bytes('<!DOCTYPE html><p>x'), null, 'page')).toBe('html');
  });

  it('refuses other types', () => {
    expect(() => detectFormat(bytes('\x89PNG'), 'image/png', 'a.png')).toThrow(
      /Unsupported content type image\/png/,
    );
  });

  it('reads uploads by extension only', () => {
    expect(uploadFormat('notes.MD')).toBe('markdown');
    expect(uploadFormat('paper.pdf')).toBe('pdf');
    expect(() => uploadFormat('page.html')).toThrow(/only \.md, \.txt and \.pdf/);
  });
});
