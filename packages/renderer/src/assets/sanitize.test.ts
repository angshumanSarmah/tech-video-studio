import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHouseSvg, serializeHouseSvg } from './house-svg.ts';
import { SANITIZE_LIMITS, sanitizeAssetSvg, type SanitizeResult } from './sanitize.ts';
import { SEED_ASSETS } from './seed.ts';

const dir = join(import.meta.dirname, 'fixtures', 'sanitize');
const fixtures = (kind: string) =>
  readdirSync(join(dir, kind))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => [f, readFileSync(join(dir, kind, f), 'utf8')] as const);

const problems = (r: SanitizeResult) => (r.ok ? [] : r.problems);
const H =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">';
const svg = (body: string) => `${H}${body}</svg>`;

describe('sanitizeAssetSvg: malicious files', () => {
  it('has fixtures', () => expect(fixtures('malicious').length).toBeGreaterThanOrEqual(15));

  it.each(fixtures('malicious'))('refuses %s as unsafe', (_name, text) => {
    for (const mode of ['upload', 'draft'] as const) {
      const result = sanitizeAssetSvg(text, mode);
      expect(result.ok).toBe(false);
      expect(problems(result).some((p) => p.startsWith('Refused'))).toBe(true);
    }
  });
});

/** What each invalid fixture is reported for (a part of one problem). */
const INVALID: Record<string, string> = {
  'wrong-viewbox.svg': 'viewBox="0 0 24 24"',
  'hex-colour.svg': 'stroke="#ff0000" is not a palette token',
  'named-colour.svg': 'fill="black" is not a palette token',
  'text.svg': '<text> is not allowed',
  'gradient.svg': '<defs> is not allowed',
  'filter.svg': 'attribute "filter" is not allowed',
  'mask.svg': '<mask> is not allowed',
  'transform.svg': 'transform is not allowed',
  'group-transform.svg': '<g> transform is not allowed',
  'opacity.svg': 'attribute "opacity" is not allowed',
  'dasharray.svg': 'attribute "stroke-dasharray" is not allowed',
  'units.svg': 'width="16px" must be a plain number',
  'bad-path.svg': 'Unknown path command "X"',
  'out-of-bounds.svg': 'outside the 24×24 box',
  'unclosed.svg': 'Not well-formed XML',
  'two-roots.svg': 'Not well-formed XML',
  'no-shapes.svg': 'No shapes to draw',
  'not-svg.svg': 'exactly one <svg> root',
  'wrong-namespace.svg': 'xmlns must be',
  'too-many-shapes.svg': 'More than 48 shapes',
};

describe('sanitizeAssetSvg: invalid files', () => {
  it('has an expectation for every fixture', () => {
    expect(
      fixtures('invalid')
        .map(([f]) => f)
        .sort(),
    ).toEqual(Object.keys(INVALID).sort());
  });

  it.each(fixtures('invalid'))('reports %s', (name, text) => {
    const result = sanitizeAssetSvg(text);
    expect(result.ok).toBe(false);
    expect(problems(result).join('\n')).toContain(INVALID[name]);
    expect(problems(result).some((p) => p.startsWith('Refused'))).toBe(false);
  });

  it('reports a file over the size limit before reading it', () => {
    const big = svg(`<path d="M4 12h16" />${' '.repeat(SANITIZE_LIMITS.upload.inputBytes)}`);
    expect(problems(sanitizeAssetSvg(big))).toEqual(['The file is larger than 64 KB.']);
  });
});

describe('sanitizeAssetSvg: fixable files', () => {
  it('cleans a design tool export and says what it changed', () => {
    const [, text] = fixtures('fixable').find(([f]) => f === 'design-tool-export.svg')!;
    const result = sanitizeAssetSvg(text);
    if (!result.ok) throw new Error(result.problems.join(' '));
    expect(result.fixes).toEqual(
      expect.arrayContaining([
        'Comments dropped.',
        '<title> dropped.',
        '<desc> dropped.',
        'Groups flattened.',
        'id dropped.',
        'data-name dropped.',
        'stroke-width dropped.',
      ]),
    );
    expect(result.shapes.map((s) => s.tag)).toEqual(['path', 'path', 'line']);
    // Uploads keep their precision; drafts are rounded to two decimals.
    expect(result.shapes[2]?.attrs.y1).toBe('18.333333');
    const draft = sanitizeAssetSvg(text, 'draft');
    if (!draft.ok) throw new Error(draft.problems.join(' '));
    expect(draft.fixes).toContain('Coordinates rounded to two decimals.');
    expect(draft.shapes[0]?.attrs.d).toBe('M9 2v6M15 2v6');
    expect(draft.shapes[2]?.attrs.y1).toBe('18.33');
  });

  it('fixes the case of currentColor and passes paint down through nested groups', () => {
    const [, text] = fixtures('fixable').find(([f]) => f === 'case-and-nesting.svg')!;
    const result = sanitizeAssetSvg(text);
    if (!result.ok) throw new Error(result.problems.join(' '));
    expect(result.fixes).toContain('stroke="CurrentColor" read as currentColor.');
    expect(result.shapes).toEqual([
      {
        tag: 'rect',
        attrs: { x: '4', y: '6', width: '16', height: '12', rx: '2', fill: 'var(--asset-fill)' },
      },
      {
        tag: 'circle',
        attrs: { cx: '12', cy: '12', r: '1', fill: 'currentColor', stroke: 'none' },
      },
    ]);
  });
});

describe('sanitizeAssetSvg: results', () => {
  it('passes every core seed asset unchanged, with nothing to fix', () => {
    for (const asset of SEED_ASSETS) {
      const result = sanitizeAssetSvg(serializeHouseSvg(asset.shapes));
      expect(result, asset.id).toMatchObject({ ok: true, fixes: [], shapes: asset.shapes });
    }
  });

  it('gives canonical house SVG that parseHouseSvg accepts, for every file it accepts', () => {
    const accepted = [
      ...fixtures('fixable').map(([, t]) => t),
      ...SEED_ASSETS.map((a) => serializeHouseSvg(a.shapes)),
    ];
    for (const text of accepted) {
      const result = sanitizeAssetSvg(text);
      if (!result.ok) throw new Error(result.problems.join(' '));
      expect(parseHouseSvg(result.svg)).toEqual({ ok: true, shapes: result.shapes });
      expect(sanitizeAssetSvg(result.svg)).toMatchObject({ ok: true, fixes: [] });
    }
  });

  it('measures arcs and curves by the line drawn, not by their radii or control points', () => {
    // The seed database's arc ends at x 21 with rx 9: its extent stays inside the box.
    expect(sanitizeAssetSvg(svg('<path d="M3 5V19A9 3 0 0 0 21 19V5" />')).ok).toBe(true);
    expect(sanitizeAssetSvg(svg('<path d="M3 12A9 9 0 0 0 21 12A9 9 0 0 0 3 12" />')).ok).toBe(
      true,
    );
    expect(problems(sanitizeAssetSvg(svg('<path d="M2 12C2 -6 22 -6 22 12" />')))).toEqual([
      'A shape reaches outside the 24×24 box.',
    ]);
  });
});

describe('sanitizeAssetSvg: the drafter’s checks (draft mode)', () => {
  const draft = (body: string) => problems(sanitizeAssetSvg(svg(body), 'draft'));

  it('accepts a simple, centred, stroked glyph', () => {
    expect(draft('<rect x="4" y="6" width="16" height="12" rx="2" /><path d="M8 10h8" />')).toEqual(
      [],
    );
  });

  it.each([
    ['touching the edge', '<path d="M0.5 12h20" />', 'touches the edge'],
    ['too small', '<circle cx="12" cy="12" r="2" />', 'too small'],
    [
      'nothing stroked',
      '<circle cx="12" cy="12" r="6" stroke="none" fill="var(--asset-fill)" />',
      'Nothing is stroked',
    ],
    [
      'two soft fills',
      '<rect x="4" y="4" width="7" height="7" fill="var(--asset-fill)" /><rect x="13" y="13" width="7" height="7" fill="var(--asset-fill)" />',
      'More than one shape uses var(--asset-fill)',
    ],
    [
      'a large solid fill',
      '<circle cx="12" cy="12" r="6" fill="currentColor" />',
      'large solid fill',
    ],
    ['a repeated shape', '<path d="M4 12h16" /><path d="M4 12h16" />', 'repeats an earlier shape'],
  ])('reports %s', (_what, body, expected) => {
    expect(draft(body).join('\n')).toContain(expected);
    expect(problems(sanitizeAssetSvg(svg(body), 'upload')).join('\n')).not.toContain(expected);
  });

  it('holds drafts to 32 shapes and 8 KB', () => {
    const many = Array.from({ length: 33 }, (_, i) => `<path d="M4 ${4 + (i % 16)}h${2 + i}" />`);
    expect(draft(many.join(''))).toContain('More than 32 shapes.');
    const big = svg(`<path d="M4 12h16" />${' '.repeat(SANITIZE_LIMITS.draft.inputBytes)}`);
    expect(problems(sanitizeAssetSvg(big, 'draft'))).toEqual(['The file is larger than 8 KB.']);
  });
});
