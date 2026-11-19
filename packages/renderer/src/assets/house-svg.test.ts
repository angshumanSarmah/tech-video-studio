import { describe, expect, it } from 'vitest';
import {
  HOUSE_MAX_BYTES,
  parseHouseSvg,
  restyleIconNode,
  serializeHouseSvg,
  type IconNodeElement,
} from './house-svg.ts';

const svg = (body: string, root = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"') =>
  `<svg ${root}>${body}</svg>`;

function problems(text: string): string[] {
  const result = parseHouseSvg(text);
  return result.ok ? [] : result.problems;
}

describe('parseHouseSvg', () => {
  it('reads shapes in order, ignoring the XML declaration, comments and whitespace', () => {
    const text = `<?xml version="1.0"?><!-- drafted -->\n${svg(
      '\n  <circle cx="12" cy="12" r="4" fill="var(--asset-fill)" />\n  <path d="M2 2h20" />\n',
    )}`;
    expect(parseHouseSvg(text)).toEqual({
      ok: true,
      shapes: [
        { tag: 'circle', attrs: { cx: '12', cy: '12', r: '4', fill: 'var(--asset-fill)' } },
        { tag: 'path', attrs: { d: 'M2 2h20' } },
      ],
    });
  });

  it('round-trips through the canonical serialisation', () => {
    const shapes = [
      { tag: 'rect' as const, attrs: { x: '2', y: '2', width: '20', height: '8', rx: '2' } },
      { tag: 'line' as const, attrs: { x1: '6', y1: '6', x2: '6.01', y2: '6' } },
      { tag: 'polyline' as const, attrs: { points: '4 4 8 8', stroke: 'currentColor' as const } },
    ];
    expect(parseHouseSvg(serializeHouseSvg(shapes))).toEqual({ ok: true, shapes });
  });

  it.each([
    ['a script', svg('<script>alert(1)</script>'), /<script> is not allowed/],
    ['foreignObject', svg('<foreignObject><div/></foreignObject>'), /<foreignObject>/],
    ['a group', svg('<g><path d="M0 0"/></g>'), /<g> is not allowed/],
    ['an image', svg('<image href="https://example.com/x.png"/>'), /<image>/],
    ['text', svg('<path d="M0 0"/>hello'), /Text content/],
    ['an event handler', svg('<path d="M0 0" onload="x()"/>'), /onload not allowed/],
    ['a raw colour', svg('<path d="M0 0" fill="#ff0000"/>'), /palette tokens/],
    ['an inline style', svg('<path d="M0 0" style="fill:red"/>'), /style not allowed/],
    ['a transform', svg('<path d="M0 0" transform="scale(2)"/>'), /transform not allowed/],
    ['another viewBox', svg('<path d="M0 0"/>', 'viewBox="0 0 32 32"'), /viewBox="0 0 32 32"/],
    ['no viewBox', svg('<path d="M0 0"/>', 'fill="none"'), /needs viewBox/],
    [
      'a square cap',
      svg('<path d="M0 0"/>', 'viewBox="0 0 24 24" stroke-linecap="square"'),
      /round/,
    ],
    ['no shapes', svg(''), /No shapes/],
    ['two roots', `${svg('<path d="M0 0"/>')}${svg('<path d="M0 0"/>')}`, /Not well-formed/],
    ['another root', '<html><path d="M0 0"/></html>', /exactly one <svg>/],
    ['malformed XML', '<svg viewBox="0 0 24 24"><path d="M0 0"></svg>', /Not well-formed/],
  ])('rejects %s', (_name, text, problem) => {
    expect(problems(text).join('\n')).toMatch(problem);
  });

  it('rejects files over the size limit and with too many shapes', () => {
    const big = svg(`<path d="M0 0${' l1 1'.repeat(HOUSE_MAX_BYTES / 4)}"/>`);
    expect(problems(big)).toEqual([`File is larger than ${HOUSE_MAX_BYTES} bytes.`]);
    const many = svg('<circle cx="1" cy="1" r="1"/>'.repeat(49));
    expect(problems(many)).toEqual(['More than 48 shapes.']);
  });
});

describe('restyleIconNode', () => {
  it('keeps geometry and palette colours, and drops sizes, keys and stroke widths', () => {
    const node: IconNodeElement[] = [
      ['circle', { cx: 12, cy: 12, r: '2', fill: 'currentColor', key: 'a', 'stroke-width': 3 }],
      ['path', { d: 'M1 1', stroke: 'none', fill: '#000' }],
    ];
    expect(restyleIconNode('example', node)).toEqual([
      { tag: 'circle', attrs: { cx: '12', cy: '12', r: '2', fill: 'currentColor' } },
      { tag: 'path', attrs: { d: 'M1 1', stroke: 'none' } },
    ]);
  });

  it('throws on tags outside the house format', () => {
    expect(() => restyleIconNode('example', [['text', {}]])).toThrow(/not a house shape/);
  });
});
