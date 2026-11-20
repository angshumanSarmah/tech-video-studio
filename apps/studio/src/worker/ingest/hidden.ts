/**
 * Removes what a browser would not show before any text is taken from a page, so hidden text
 * (e.g. instructions planted for LLMs) never reaches the Researcher:
 * - elements whose content is not shown as text: `template`, `noscript` (its fallback shows only
 *   with scripts disabled), `script`, `style`, `iframe`, `object`, `embed`, `svg`, `canvas`,
 *   hidden inputs;
 * - the `hidden` attribute and `aria-hidden="true"`;
 * - `display: none`, `visibility: hidden | collapse` and `content-visibility: hidden`, from
 *   inline styles and from the page's own `<style>` rules (top level, `@supports`, and `@media`
 *   that applies to every screen; width-conditional and print rules are skipped).
 *
 * Rules are applied without the cascade: a hiding rule removes its matches even when a more
 * specific rule shows them again, so this errs toward dropping text. `html` and `body` are never
 * removed (pages that hide the body until a script runs would otherwise lose everything).
 * External stylesheets are not fetched (no crawling), and other tricks (`opacity: 0`, off-screen
 * positioning, text coloured like its background) are not detected: see docs/TODO.md.
 */

const NEVER_RENDERED = [
  'template',
  'noscript',
  'script',
  'style',
  'link',
  'iframe',
  'object',
  'embed',
  'svg',
  'canvas',
  'input[type="hidden" i]',
  '[hidden]',
  '[aria-hidden="true" i]',
].join(', ');

const KEPT = new Set(['HTML', 'BODY']);

/** Removes every hidden element from `document`; returns how many subtrees were removed. */
export function removeHiddenContent(document: Document): number {
  const doomed = new Set<Element>([
    ...stylesheetHidden(document),
    ...inlineHidden(document),
    ...document.querySelectorAll(NEVER_RENDERED),
  ]);
  let removed = 0;
  for (const element of doomed) {
    if (KEPT.has(element.tagName) || !element.isConnected) continue;
    element.remove();
    removed++;
  }
  return removed;
}

/** Whether a declaration block hides its element. */
export function hidesElement(declarations: ReadonlyMap<string, string>): boolean {
  const display = declarations.get('display');
  const visibility = declarations.get('visibility');
  return (
    display === 'none' ||
    visibility === 'hidden' ||
    visibility === 'collapse' ||
    declarations.get('content-visibility') === 'hidden'
  );
}

/** `prop: value; …` → lower-case property → lower-case value, `!important` dropped. */
export function parseDeclarations(cssText: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of cssText.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .replace(/!\s*important/i, '')
      .trim()
      .toLowerCase();
    if (prop !== '') out.set(prop, value);
  }
  return out;
}

function inlineHidden(document: Document): Element[] {
  return [...document.querySelectorAll('[style]')].filter((el) =>
    hidesElement(parseDeclarations(el.getAttribute('style') ?? '')),
  );
}

/** Minimal CSSOM shapes, read by duck typing (jsdom's rule classes are not exported). */
interface StyleRuleLike {
  readonly selectorText: string;
  readonly style: { readonly cssText: string };
}
interface GroupRuleLike {
  readonly cssRules: ArrayLike<unknown>;
  readonly media?: { readonly mediaText: string };
  readonly conditionText?: string;
}

function stylesheetHidden(document: Document): Element[] {
  const selectors: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: ArrayLike<unknown>;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    collectHidingSelectors(rules, selectors);
  }
  return selectors.flatMap((selector) => matches(document, selector));
}

function collectHidingSelectors(rules: ArrayLike<unknown>, out: string[]): void {
  for (const rule of Array.from(rules)) {
    if (isStyleRule(rule)) {
      if (hidesElement(parseDeclarations(rule.style.cssText))) out.push(rule.selectorText);
    } else if (isGroupRule(rule) && groupApplies(rule)) {
      collectHidingSelectors(rule.cssRules, out);
    }
  }
}

function isStyleRule(rule: unknown): rule is StyleRuleLike {
  return typeof (rule as StyleRuleLike).selectorText === 'string';
}

function isGroupRule(rule: unknown): rule is GroupRuleLike {
  return typeof (rule as GroupRuleLike).cssRules === 'object';
}

/** `@supports` always; `@media` only when it applies to every screen (no conditions). */
function groupApplies(rule: GroupRuleLike): boolean {
  if (rule.media === undefined) return rule.conditionText !== undefined;
  const media = rule.media.mediaText.trim().toLowerCase();
  return media === '' || /^(only\s+)?(all|screen)$/.test(media);
}

/** Elements a selector list matches; parts the DOM cannot evaluate (pseudo-elements) match none. */
function matches(document: Document, selectorList: string): Element[] {
  return splitSelectorList(selectorList).flatMap((selector) => {
    if (/::|:(before|after|first-line|first-letter|marker|placeholder)\b/i.test(selector))
      return [];
    try {
      return [...document.querySelectorAll(selector)];
    } catch {
      return [];
    }
  });
}

/** Splits at top-level commas (not inside `:is(…)`, `[attr="a,b"]`). */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (quote) {
      if (c === quote && list[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}
