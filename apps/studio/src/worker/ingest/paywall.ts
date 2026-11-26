import { SourceIngestError, UPLOAD_INSTEAD } from './errors.ts';

/**
 * Pages that show only a preview of a paid article (pure over a parsed document; before
 * `removeHiddenContent` and Readability, which would drop or skip the markers). Read only where a
 * page states it: schema.org JSON-LD `isAccessibleForFree: false` (what search engines are given
 * for paywalled content), a Substack post whose `audience` is paid (`only_paid`, `founding`) in
 * its `preloads-json`, or a paywall element (class `paywall`, `data-testid="paywall"`). The bare
 * word is not enough: a free Substack post carries `paywall_free_trial_enabled` and the like in
 * its config JSON (run 1's third source was free).
 */

const PAID_AUDIENCES = new Set(['only_paid', 'founding']);

export type PaywallMarker = 'json_ld' | 'substack_audience' | 'paywall_element';

/** The first marker that says the page is paywalled, or null. */
export function paywallMarker(document: Document): PaywallMarker | null {
  if (jsonLdBlocks(document).some(isNotFree)) return 'json_ld';
  if (substackAudience(document)) return 'substack_audience';
  if (document.querySelector('.paywall, [data-testid="paywall"]')) return 'paywall_element';
  return null;
}

/** Throws `paywalled` (with the paste or upload hint) when the page is a paid article's preview. */
export function refusePaywalled(document: Document): void {
  const marker = paywallMarker(document);
  if (!marker) return;
  throw new SourceIngestError(
    'paywalled',
    `The page is paywalled (${MARKER_TEXT[marker]}): only a preview is public, so ${UPLOAD_INSTEAD}.`,
  );
}

const MARKER_TEXT: Readonly<Record<PaywallMarker, string>> = {
  json_ld: 'it marks itself not free to read',
  substack_audience: 'a paid-subscriber post',
  paywall_element: 'it shows a paywall',
};

function jsonLdBlocks(document: Document): unknown[] {
  return [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => {
    try {
      const value: unknown = JSON.parse(s.textContent ?? '');
      return Array.isArray(value) ? (value as unknown[]) : [value];
    } catch {
      return [];
    }
  });
}

/** `isAccessibleForFree` false (boolean or the string "False"), on the item or its @graph. */
function isNotFree(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const flag = record['isAccessibleForFree'];
  if (flag === false || (typeof flag === 'string' && flag.toLowerCase() === 'false')) return true;
  const graph = record['@graph'];
  return Array.isArray(graph) && graph.some(isNotFree);
}

function substackAudience(document: Document): boolean {
  const script = document.querySelector('script#preloads-json[type="application/json"]');
  if (!script) return false;
  try {
    const preloads: unknown = JSON.parse(script.textContent ?? '');
    const post = (preloads as { post?: { audience?: unknown } } | null)?.post;
    return typeof post?.audience === 'string' && PAID_AUDIENCES.has(post.audience);
  } catch {
    return false;
  }
}
