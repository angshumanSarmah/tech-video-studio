import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_THEME_ID,
  fontStack,
  getTheme,
  withAlpha,
  type Theme,
} from '@explainer-studio/renderer/theme';

/**
 * The studio's Tailwind tokens are generated from the renderer theme so the UI and the video share
 * one palette. Token names are the studio's; the mapping below is the only place they meet.
 */
const COLOUR_TOKENS: readonly [token: string, pick: (t: Theme) => string][] = [
  ['canvas', (t) => t.colours.background],
  ['panel', (t) => t.colours.surface],
  ['panel-raised', (t) => t.colours.surfaceRaised],
  ['line', (t) => t.colours.line],
  ['grid', (t) => withAlpha(t.grid.colour, t.grid.minorAlpha)],
  ['grid-major', (t) => withAlpha(t.grid.colour, t.grid.majorAlpha)],
  ['ink', (t) => t.colours.ink.primary],
  ['ink-muted', (t) => t.colours.ink.muted],
  ['ink-faint', (t) => t.colours.ink.faint],
  ['focus', (t) => t.colours.semantic.focus],
  ['ok', (t) => t.colours.semantic.ok],
  ['problem', (t) => t.colours.semantic.problem],
  ['concept', (t) => t.colours.semantic.concept],
];

export const GENERATED_CSS_PATH = fileURLToPath(
  new URL('../src/web/theme.generated.css', import.meta.url),
);

/** Renderer `public/` dir, where the theme's font files live. */
function rendererPublicDir(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@explainer-studio/renderer/package.json')), 'public');
}

function fontFaces(theme: Theme, fontHref: (path: string) => string): string[] {
  const { family, files } = theme.fonts.mono;
  return files.map((file) =>
    [
      '@font-face {',
      `  font-family: '${family}';`,
      '  font-style: normal;',
      `  font-weight: ${file.weight};`,
      '  font-display: swap;',
      `  src: url('${fontHref(file.path)}') format('woff2');`,
      '}',
    ].join('\n'),
  );
}

/** Pure: the CSS file contents for `theme`, with font URLs produced by `fontHref`. */
export function buildThemeCss(theme: Theme, fontHref: (path: string) => string): string {
  const tokens = [
    ...COLOUR_TOKENS.map(([token, pick]) => `  --color-${token}: ${pick(theme)};`),
    `  --font-mono: ${fontStack(theme, 'mono')};`,
  ];
  return [
    `/* Generated from the renderer theme "${theme.id}". Do not edit by hand. */`,
    '/* Regenerate: pnpm --filter @explainer-studio/studio gen:theme */',
    '',
    ...fontFaces(theme, fontHref).flatMap((face) => [face, '']),
    '@theme {',
    ...tokens,
    '}',
    '',
  ].join('\n');
}

/** The expected contents of `GENERATED_CSS_PATH` for the default theme. */
export function expectedThemeCss(): string {
  const publicDir = rendererPublicDir();
  const cssDir = dirname(GENERATED_CSS_PATH);
  const fontHref = (path: string) => relative(cssDir, join(publicDir, path)).split('\\').join('/');
  return buildThemeCss(getTheme(DEFAULT_THEME_ID), fontHref);
}
