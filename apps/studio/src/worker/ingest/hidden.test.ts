import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { hidesElement, parseDeclarations, removeHiddenContent } from './hidden.ts';

function cleaned(html: string): string {
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  removeHiddenContent(dom.window.document);
  return dom.window.document.body.textContent ?? '';
}

describe('removeHiddenContent', () => {
  it('never removes html or body, even when a rule hides them', () => {
    const text = cleaned(
      '<style>body { visibility: hidden } html { display: none }</style><p>shown after load</p>',
    );
    expect(text).toContain('shown after load');
  });

  it('applies a rule to every selector in its list, including ones inside :is()', () => {
    const text = cleaned(
      '<style>.a, :is(.b, .c) { display: none }</style><p class="a">A</p><p class="c">C</p><p>D</p>',
    );
    expect(text).not.toContain('A');
    expect(text).not.toContain('C');
    expect(text).toContain('D');
  });

  it('ignores selectors the DOM cannot evaluate instead of failing', () => {
    const text = cleaned('<style>p:unknown-thing { display: none }</style><p>kept</p>');
    expect(text).toContain('kept');
  });

  it('keeps opacity:0 text (scroll-reveal animations start there)', () => {
    expect(cleaned('<p style="opacity: 0">fades in</p>')).toContain('fades in');
  });
});

describe('declarations', () => {
  it('parses case-insensitively and drops !important', () => {
    const d = parseDeclarations('Display: NONE !important; color: red');
    expect(d.get('display')).toBe('none');
    expect(hidesElement(d)).toBe(true);
  });

  it('hides on display none, visibility hidden or collapse, content-visibility hidden only', () => {
    const hides = (css: string) => hidesElement(parseDeclarations(css));
    expect(hides('visibility: collapse')).toBe(true);
    expect(hides('content-visibility: hidden')).toBe(true);
    expect(hides('display: block; visibility: visible')).toBe(false);
  });
});
