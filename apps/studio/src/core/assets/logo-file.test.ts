import { LOGO_MAX_BYTES } from '@explainer-studio/shared';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLogoFile, loadLogoFiles } from './logo-file.ts';

/** A PNG header (signature + IHDR) of the given size; enough for the size check. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const svg = (attrs: string, body = '<rect width="10" height="10" fill="#e33"/>') =>
  new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`);

describe('checkLogoFile', () => {
  it('accepts a small PNG and an SVG sized by viewBox or width and height', () => {
    expect(checkLogoFile(png(512, 256), 'png')).toEqual({ ok: true, mime: 'image/png' });
    expect(checkLogoFile(svg('viewBox="0 0 200 80"'), 'svg')).toEqual({
      ok: true,
      mime: 'image/svg+xml',
    });
    expect(checkLogoFile(svg('width="300px" height="120"'), 'svg').ok).toBe(true);
  });

  it.each([
    ['a PNG over 1024 px', png(2048, 100), 'png', /2048 × 100 px/],
    ['a fake PNG', new TextEncoder().encode('GIF89a not a png file at all'), 'png', /Not a PNG/],
    ['an SVG over 1024 px', svg('viewBox="0 0 4000 1000"'), 'svg', /at most 1024 px/],
    ['an unsized SVG', svg(''), 'svg', /needs a viewBox/],
    ['an SVG with a script', svg('viewBox="0 0 10 10"', '<script>x()</script>'), 'svg', /scripts/],
    [
      'an external reference',
      svg('viewBox="0 0 10 10"', '<image href="https://example.com/a.png"/>'),
      'svg',
      /external/,
    ],
    ['malformed SVG', new TextEncoder().encode('<svg><g></svg>'), 'svg', /well-formed/],
    ['a file over 300 KB', new Uint8Array(LOGO_MAX_BYTES + 1), 'png', /Larger than 300 KB/],
  ] as const)('rejects %s', (_name, bytes, ext, problem) => {
    const check = checkLogoFile(bytes, ext);
    expect(check.ok).toBe(false);
    expect(!check.ok && check.problem).toMatch(problem);
  });
});

describe('loadLogoFiles', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'logos-'));
  const logos = join(dataDir, 'runs', '7', 'logos');
  mkdirSync(logos, { recursive: true });
  writeFileSync(join(logos, 'logo_ok.png'), png(64, 64));
  writeFileSync(join(logos, 'logo_big.png'), png(4096, 64));
  writeFileSync(join(logos, 'logo_both.png'), png(64, 64));
  writeFileSync(join(logos, 'logo_both.svg'), svg('viewBox="0 0 10 10"'));
  const slot = (id: string) => ({ id, label: '<example-company>' });

  it('loads valid files as data URIs, skips unfilled slots and reports bad files', () => {
    const load = loadLogoFiles(
      dataDir,
      7,
      ['logo_ok', 'logo_big', 'logo_both', 'logo_none'].map(slot),
    );
    expect(load.logos.map((l) => [l.kind, l.id, l.mime])).toEqual([
      ['logo', 'logo_ok', 'image/png'],
    ]);
    expect(load.logos[0]?.dataUri).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(load.problems.map((p) => p.id)).toEqual(['logo_big', 'logo_both']);
  });
});
