import { readFileSync } from 'node:fs';
import { sourceQuality, THIN_SOURCE_CHARS } from '@explainer-studio/shared';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { SourceIngestError } from './errors.ts';
import { decodeHtml, extractHtml } from './html.ts';
import { normalizeText } from './normalize.ts';
import { paywallMarker } from './paywall.ts';

/**
 * Run 1's third source in shape (`fixtures/diagram-post.html`: a real newsletter page's markup,
 * invented words): a free post whose content was a diagram. It must read as a thin source that
 * points at an image, never as paywalled; the paid variant must be refused as `paywalled`.
 */

const URL_ = 'https://notes.example.com/p/why-is-quillstore-so-quick';
const page = (name: string) =>
  decodeHtml(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)), 'text/html');
const documentOf = (html: string) => new JSDOM(html, { url: URL_ }).window.document;

describe('paywall detection', () => {
  it('a free post is not paywalled, though its config names "paywall"', () => {
    expect(page('diagram-post.html')).toContain('paywall_free_trial_enabled');
    expect(paywallMarker(documentOf(page('diagram-post.html')))).toBeNull();
  });

  it('reads each marker a paid page states', () => {
    expect(paywallMarker(documentOf(page('paywalled-post.html')))).toBe('json_ld');
    const audienceOnly = page('diagram-post.html').replace(
      '"audience":"everyone"',
      '"audience":"only_paid"',
    );
    expect(paywallMarker(documentOf(audienceOnly))).toBe('substack_audience');
    const elementOnly = page('diagram-post.html').replace(
      '<div class="visibility-check"></div>',
      '<div class="paywall"><h4>For paid subscribers</h4></div>',
    );
    expect(paywallMarker(documentOf(elementOnly))).toBe('paywall_element');
    const graph = page('diagram-post.html').replace(
      /<script type="application\/ld\+json">.*?<\/script>/s,
      '<script type="application/ld+json">{"@graph":[{"@type":"Article","isAccessibleForFree":"False"}]}</script>',
    );
    expect(paywallMarker(documentOf(graph))).toBe('json_ld');
  });

  it('refuses the paid page as paywalled, with the paste or upload hint', () => {
    const extract = () => extractHtml(page('paywalled-post.html'), URL_);
    expect(extract).toThrow(SourceIngestError);
    try {
      extract();
    } catch (error) {
      expect((error as SourceIngestError).code).toBe('paywalled');
      expect((error as Error).message).toMatch(
        /^The page is paywalled \(it marks itself not free to read\): only a preview is public, so paste its text as a source instead, or upload the page as a file/,
      );
    }
  });
});

describe('the free diagram post (run 1, source 3, in shape)', () => {
  const text = normalizeText(extractHtml(page('diagram-post.html'), URL_).text);

  it('extracts about as much as the real one did (511 characters)', () => {
    expect(text.length).toBeGreaterThan(420);
    expect(text.length).toBeLessThan(600);
    expect(text).toContain('as shown in the diagram below');
    expect(text).toContain('https://shop.example.com/b/k7Q2mR');
  });

  it('is a thin source: its text points at a diagram and much of it is links and plugs', () => {
    const quality = sourceQuality(text);
    expect(quality.substantiveChars).toBeLessThan(THIN_SOURCE_CHARS);
    expect(quality.substantiveChars).toBeLessThan(text.length);
    expect(quality.thin).toEqual(['points_at_image']);
    expect(quality.pointsAtImage).toBe(true);
  });
});
